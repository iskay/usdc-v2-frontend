/**
 * Namada Chain Poller
 * 
 * Polls Namada chain for IBC events (write_acknowledgement for deposits, send_packet for payments).
 * Implements ChainPoller interface for modularity.
 * 
 * Supports:
 * - Deposit flow: write_acknowledgement by packet_sequence (or packet_data fallback)
 * - Payment flow: send_packet by inner-tx-hash at specific block height
 */

import type {
  ChainPoller,
  ChainPollParams,
  ChainPollResult,
  NamadaPollParams,
} from './types'
import type { ChainStage } from '@/types/flow'
import {
  retryWithBackoff,
  createPollTimeout,
  isAborted,
  createErrorResult,
  indexAttributes,
} from './basePoller'
import {
  createTendermintRpcClient,
  getTendermintRpcUrl,
  type TendermintBlockResults,
} from './tendermintRpcClient'
import { DEPOSIT_STAGES, PAYMENT_STAGES } from '@/shared/flowStages'
import { logger } from '@/utils/logger'

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Poll for deposit flow: write_acknowledgement by packet_sequence or packet_data
 */
async function pollForDeposit(
  params: NamadaPollParams,
  rpcClient: ReturnType<typeof createTendermintRpcClient>,
): Promise<ChainPollResult> {
  const timeoutMs = params.timeoutMs ?? 30 * 60 * 1000
  const intervalMs = params.intervalMs ?? 5000
  const blockRequestDelayMs = params.blockRequestDelayMs ?? 100
  const { controller, cleanup, wasTimeout } = createPollTimeout(
    timeoutMs,
    params.flowId,
    params.abortSignal,
  )
  const abortSignal = params.abortSignal || controller.signal

  logger.info('[NamadaPoller] Starting Namada deposit poll', {
    flowId: params.flowId,
    startHeight: params.metadata.startHeight,
    packetSequence: params.metadata.packetSequence,
    forwardingAddress: params.metadata.forwardingAddress,
    namadaReceiver: params.metadata.namadaReceiver,
  })

  const stages: ChainStage[] = [
    {
      stage: DEPOSIT_STAGES.NAMADA_POLLING,
      status: 'pending',
      source: 'poller',
      occurredAt: new Date().toISOString(),
    },
  ]

  const deadline = Date.now() + timeoutMs
  let nextHeight = params.metadata.startHeight || 0
  const denom = 'uusdc'
  const expectedAmount = params.metadata.expectedAmountUusdc

  let ackFound = false
  let foundAt: number | undefined
  let namadaTxHash: string | undefined

  // Warn if packetSequence is not provided (backward compatibility)
  if (!params.metadata.packetSequence) {
    logger.warn('[NamadaPoller] packetSequence not provided, falling back to packet_data matching', {
      flowId: params.flowId,
    })
  }

  try {
    while (Date.now() < deadline && !ackFound) {
      if (isAborted(abortSignal)) break

      const latest = await retryWithBackoff(
        () => rpcClient.getLatestBlockHeight(abortSignal),
        3,
        500,
        5000,
        abortSignal,
      )

      logger.debug('[NamadaPoller] Deposit poll progress', {
        flowId: params.flowId,
        latest,
        nextHeight,
      })

      while (nextHeight <= latest && !ackFound) {
        if (isAborted(abortSignal)) break

        try {
          const blockResults = await retryWithBackoff(
            () => rpcClient.getBlockResults(nextHeight, abortSignal),
            3,
            500,
            5000,
            abortSignal,
          )

          if (!blockResults) {
            logger.debug('[NamadaPoller] No block results for height', {
              flowId: params.flowId,
              height: nextHeight,
            })
            nextHeight++
            await sleep(blockRequestDelayMs)
            continue
          }

          // Access end_block_events
          const endEvents = (blockResults as unknown as {
            end_block_events?: Array<{
              type: string
              attributes?: Array<{ key: string; value: string; index?: boolean }>
            }>
          }).end_block_events || []

          // If packetSequence is provided, use efficient matching logic
          if (params.metadata.packetSequence !== undefined) {
            // Search for write_acknowledgement event matching packet_sequence
            for (const ev of endEvents) {
              if (ev?.type !== 'write_acknowledgement') continue

              const attrs = indexAttributes(ev.attributes)
              const packetSeqStr = attrs['packet_sequence']
              const packetAck = attrs['packet_ack']
              const innerTxHashAttr = attrs['inner-tx-hash']

              // Match by packet_sequence
              if (!packetSeqStr) continue
              const packetSeq = Number.parseInt(packetSeqStr, 10)
              if (packetSeq !== params.metadata.packetSequence) continue

              logger.debug('[NamadaPoller] Found write_acknowledgement with matching packet_sequence', {
                flowId: params.flowId,
                height: nextHeight,
                packetSequence: packetSeq,
                packetAck,
                hasInnerTxHash: !!innerTxHashAttr,
              })

              // Verify packet_ack is success code
              if (packetAck !== '{"result":"AQ=="}') {
                logger.error('[NamadaPoller] Packet acknowledgement indicates failure', {
                  flowId: params.flowId,
                  height: nextHeight,
                  packetSequence: packetSeq,
                  packetAck,
                })
                cleanup()
                return createErrorResult(
                  'tx_error',
                  `Packet acknowledgement indicates failure: ${packetAck}`,
                )
              }

              // Extract inner-tx-hash from write_acknowledgement event
              if (innerTxHashAttr) {
                namadaTxHash = innerTxHashAttr
              } else {
                logger.warn('[NamadaPoller] inner-tx-hash not found in write_acknowledgement event', {
                  flowId: params.flowId,
                  height: nextHeight,
                  packetSequence: packetSeq,
                })
              }

              ackFound = true
              foundAt = nextHeight
              logger.info('[NamadaPoller] Namada write_acknowledgement matched by packet_sequence', {
                flowId: params.flowId,
                height: nextHeight,
                packetSequence: packetSeq,
                txHash: namadaTxHash,
              })

              stages.push({
                stage: DEPOSIT_STAGES.NAMADA_RECEIVED,
                status: 'confirmed',
                source: 'poller',
                txHash: namadaTxHash,
                occurredAt: new Date().toISOString(),
              })
              break
            }
          } else {
            // Fallback to old packet_data matching logic (backward compatibility)
            // First pass: Extract inner-tx-hash from message event
            let innerTxHash: string | undefined
            for (const ev of endEvents) {
              if (ev?.type === 'message') {
                const attrs = indexAttributes(ev.attributes)
                const inner = attrs['inner-tx-hash']
                if (inner) {
                  innerTxHash = inner
                  break
                }
              }
            }

            // Second pass: Find and process write_acknowledgement event
            for (const ev of endEvents) {
              if (ev?.type !== 'write_acknowledgement') continue

              const attrs = indexAttributes(ev.attributes)
              const ack = attrs['packet_ack']
              const pdata = attrs['packet_data']
              const ok = ack === '{"result":"AQ=="}'

              if (!ok) continue

              try {
                // Handle both direct JSON and JSON string in 'value' field
                let parsed: Record<string, unknown>
                if (typeof pdata === 'string') {
                  parsed = JSON.parse(pdata) as Record<string, unknown>
                } else if (pdata && typeof pdata === 'object' && 'value' in pdata) {
                  parsed = JSON.parse((pdata as { value: string }).value) as Record<string, unknown>
                } else {
                  parsed = (pdata as Record<string, unknown>) || {}
                }

                const recv = parsed?.receiver
                const send = parsed?.sender
                const d = parsed?.denom
                const amount = parsed?.amount

                const receiverMatches =
                  params.metadata.namadaReceiver && recv === params.metadata.namadaReceiver
                const senderMatches =
                  params.metadata.forwardingAddress && send === params.metadata.forwardingAddress
                const denomMatches = d === denom

                // Handle amount comparison - expectedAmount might include "uusdc" suffix
                let amountMatches = true
                if (expectedAmount) {
                  const expectedNumeric = expectedAmount.replace('uusdc', '')
                  const actualNumeric = amount?.toString().replace('uusdc', '') || ''
                  amountMatches = expectedNumeric === actualNumeric
                }

                if (receiverMatches && senderMatches && denomMatches && amountMatches) {
                  ackFound = true
                  foundAt = nextHeight
                  namadaTxHash = innerTxHash
                  logger.info('[NamadaPoller] Namada write_acknowledgement matched (fallback: packet_data)', {
                    flowId: params.flowId,
                    height: nextHeight,
                    txHash: namadaTxHash,
                  })

                  stages.push({
                    stage: DEPOSIT_STAGES.NAMADA_RECEIVED,
                    status: 'confirmed',
                    source: 'poller',
                    txHash: namadaTxHash,
                    occurredAt: new Date().toISOString(),
                  })
                  break
                }
              } catch (error) {
                logger.debug('[NamadaPoller] packet_data parse failed', {
                  flowId: params.flowId,
                  error: error instanceof Error ? error.message : String(error),
                })
              }
            }
          }
        } catch (error) {
          logger.warn('[NamadaPoller] Fetch failed for height after retries, skipping block', {
            flowId: params.flowId,
            height: nextHeight,
            error: error instanceof Error ? error.message : String(error),
          })
          nextHeight++
          await sleep(blockRequestDelayMs)
          continue
        }

        nextHeight++
        await sleep(blockRequestDelayMs)
      }

      if (ackFound) break
      await sleep(intervalMs)
    }

    cleanup()

    if (wasTimeout()) {
      return createErrorResult('polling_timeout', 'Namada deposit polling timed out')
    }

    if (!ackFound) {
      return createErrorResult('polling_timeout', 'Namada write_acknowledgement not found')
    }

    logger.info('[NamadaPoller] Namada deposit poll completed', {
      flowId: params.flowId,
      ackFound,
      foundAt,
      namadaTxHash,
    })

    return {
      success: true,
      found: true,
      metadata: {
        ...params.metadata,
        namadaTxHash,
        foundAt,
      },
      stages,
      height: foundAt,
    }
  } catch (error) {
    cleanup()

    if (isAborted(abortSignal)) {
      return createErrorResult('polling_error', 'Polling cancelled')
    }

    logger.error('[NamadaPoller] Namada deposit poll error', {
      flowId: params.flowId,
      error: error instanceof Error ? error.message : String(error),
    })

    return createErrorResult(
      'polling_error',
      error instanceof Error ? error.message : 'Unknown error',
    )
  }
}

/**
 * Poll for payment flow: send_packet by inner-tx-hash at specific block height
 */
async function pollForPaymentIbcSend(
  params: NamadaPollParams,
  rpcClient: ReturnType<typeof createTendermintRpcClient>,
): Promise<ChainPollResult> {
  const { namadaBlockHeight, namadaIbcTxHash } = params.metadata

  if (namadaBlockHeight === undefined || !namadaIbcTxHash) {
    return createErrorResult(
      'polling_error',
      'namadaBlockHeight and namadaIbcTxHash are required for payment flow',
    )
  }

  logger.info('[NamadaPoller] Starting Namada payment IBC send lookup', {
    flowId: params.flowId,
    blockHeight: namadaBlockHeight,
    txHash: namadaIbcTxHash,
  })

  const stages: ChainStage[] = [
    {
      stage: PAYMENT_STAGES.NAMADA_IBC_SENT,
      status: 'pending',
      source: 'poller',
      occurredAt: new Date().toISOString(),
    },
  ]

  try {
    // Fetch block_results at the provided height
    const blockResults = await retryWithBackoff(
      () => rpcClient.getBlockResults(namadaBlockHeight, params.abortSignal),
      3,
      500,
      5000,
      params.abortSignal,
    )

    if (!blockResults) {
      logger.error('[NamadaPoller] Block results not found at height', {
        flowId: params.flowId,
        blockHeight: namadaBlockHeight,
      })
      return createErrorResult(
        'polling_error',
        `Block results not found at height ${namadaBlockHeight}`,
      )
    }

    // Access end_block_events
    const endEvents = (blockResults as unknown as {
      end_block_events?: Array<{
        type: string
        attributes?: Array<{ key: string; value: string; index?: boolean }>
      }>
    }).end_block_events || []

    logger.debug('[NamadaPoller] Searching end_block_events for send_packet event', {
      flowId: params.flowId,
      blockHeight: namadaBlockHeight,
      eventCount: endEvents.length,
    })

    // Search for send_packet event matching inner-tx-hash
    const txHashLower = namadaIbcTxHash.toLowerCase()
    let packetSequence: number | undefined

    for (const event of endEvents) {
      if (event?.type !== 'send_packet') continue

      const attrs = indexAttributes(event.attributes || [])
      const innerTxHash = attrs['inner-tx-hash']

      if (!innerTxHash) continue

      // Case-insensitive comparison
      if (innerTxHash.toLowerCase() === txHashLower) {
        logger.debug('[NamadaPoller] Found send_packet event with matching inner-tx-hash', {
          flowId: params.flowId,
          blockHeight: namadaBlockHeight,
          innerTxHash,
          txHash: namadaIbcTxHash,
        })

        // Extract packet_sequence
        const packetSeqStr = attrs['packet_sequence']
        if (packetSeqStr) {
          packetSequence = Number.parseInt(packetSeqStr, 10)
          if (!packetSequence || packetSequence <= 0) {
            logger.error('[NamadaPoller] Invalid packet_sequence value', {
              flowId: params.flowId,
              blockHeight: namadaBlockHeight,
              packetSeqStr,
            })
            return createErrorResult('polling_error', `Invalid packet_sequence: ${packetSeqStr}`)
          }

          logger.info('[NamadaPoller] Namada payment IBC send event found and packet_sequence extracted', {
            flowId: params.flowId,
            blockHeight: namadaBlockHeight,
            txHash: namadaIbcTxHash,
            packetSequence,
          })

          stages.push({
            stage: PAYMENT_STAGES.NAMADA_IBC_SENT,
            status: 'confirmed',
            source: 'poller',
            txHash: namadaIbcTxHash,
            occurredAt: new Date().toISOString(),
          })

          return {
            success: true,
            found: true,
            metadata: {
              ...params.metadata,
              packetSequence,
              namadaTxHash: namadaIbcTxHash,
            },
            stages,
            height: namadaBlockHeight,
          }
        } else {
          logger.error('[NamadaPoller] packet_sequence attribute not found in send_packet event', {
            flowId: params.flowId,
            blockHeight: namadaBlockHeight,
            txHash: namadaIbcTxHash,
          })
          return createErrorResult(
            'polling_error',
            'packet_sequence attribute not found in send_packet event',
          )
        }
      }
    }

    logger.warn('[NamadaPoller] No send_packet event found with matching inner-tx-hash', {
      flowId: params.flowId,
      blockHeight: namadaBlockHeight,
      txHash: namadaIbcTxHash,
      eventCount: endEvents.length,
    })

    return createErrorResult(
      'polling_error',
      `No send_packet event found with matching inner-tx-hash ${namadaIbcTxHash} at height ${namadaBlockHeight}`,
    )
  } catch (error) {
    logger.error('[NamadaPoller] Namada payment IBC send lookup error', {
      flowId: params.flowId,
      blockHeight: namadaBlockHeight,
      error: error instanceof Error ? error.message : String(error),
    })

    return createErrorResult(
      'polling_error',
      error instanceof Error ? error.message : 'Unknown error',
    )
  }
}

/**
 * Namada Chain Poller Implementation
 * Implements ChainPoller interface for modularity
 */
export class NamadaPoller implements ChainPoller {
  /**
   * Poll Namada chain for IBC events
   * 
   * @param params - Polling parameters
   * @returns Polling result with success status, metadata, and stages
   */
  async poll(params: ChainPollParams): Promise<ChainPollResult> {
    // Validate Namada-specific params
    const namadaParams = params as NamadaPollParams

    // Get Tendermint RPC client for Namada
    const chainKey = namadaParams.metadata.chainKey || 'namada-testnet'
    let rpcUrl: string
    try {
      rpcUrl = await getTendermintRpcUrl(chainKey)
    } catch (error) {
      logger.error('[NamadaPoller] Failed to get Tendermint RPC URL', {
        chainKey,
        error: error instanceof Error ? error.message : String(error),
      })
      return createErrorResult(
        'polling_error',
        `Failed to get RPC URL for Namada chain: ${chainKey}`,
      )
    }

    const rpcClient = createTendermintRpcClient(rpcUrl)

    // Determine flow type based on available metadata
    // Payment flow: has namadaBlockHeight and namadaIbcTxHash
    // Deposit flow: otherwise
    const isPaymentFlow =
      namadaParams.metadata.namadaBlockHeight !== undefined &&
      Boolean(namadaParams.metadata.namadaIbcTxHash)

    if (isPaymentFlow) {
      logger.info('[NamadaPoller] Using payment flow (IBC send lookup)', {
        flowId: params.flowId,
        blockHeight: namadaParams.metadata.namadaBlockHeight,
        txHash: namadaParams.metadata.namadaIbcTxHash,
      })
      return pollForPaymentIbcSend(namadaParams, rpcClient)
    } else {
      logger.info('[NamadaPoller] Using deposit flow (write_acknowledgement polling)', {
        flowId: params.flowId,
        startHeight: namadaParams.metadata.startHeight,
        packetSequence: namadaParams.metadata.packetSequence,
      })
      return pollForDeposit(namadaParams, rpcClient)
    }
  }
}

/**
 * Create Namada poller instance
 */
export function createNamadaPoller(): ChainPoller {
  return new NamadaPoller()
}

