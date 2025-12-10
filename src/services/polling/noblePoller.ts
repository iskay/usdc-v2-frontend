/**
 * Noble Chain Poller
 * 
 * Polls Noble chain for CCTP mint events and IBC forwarding events.
 * Implements ChainPoller interface for modularity.
 * 
 * Supports:
 * - Deposit flow: CCTP mint by nonce → IBC forward
 * - Payment flow: IBC acknowledgement by packet sequence → CCTP burn
 */

import type {
  ChainPoller,
  ChainPollParams,
  ChainPollResult,
} from './types'
import type { ChainStage } from '@/types/flow'
import {
  retryWithBackoff,
  createPollTimeout,
  isAborted,
  createErrorResult,
  indexAttributes,
  stripQuotes,
  sleep,
} from './basePoller'
import {
  createTendermintRpcClient,
  type TendermintTx,
} from './tendermintRpcClient'
import { getEffectiveRpcUrl } from '@/services/config/customUrlResolver'
import { DEPOSIT_STAGES, PAYMENT_STAGES } from '@/shared/flowStages'
import { logger } from '@/utils/logger'
import { fetchNobleForwardingAddress } from '@/services/deposit/nobleForwardingService'
import { extractTendermintBlockMetadata } from './blockMetadataExtractor'


/**
 * Poll for deposit flow: CCTP mint by nonce, then IBC forward
 */
async function pollForDepositWithNonce(
  params: ChainPollParams,
  rpcClient: ReturnType<typeof createTendermintRpcClient>,
): Promise<ChainPollResult> {
  // Log received metadata to diagnose missing fields
  logger.info('[NoblePoller] Received poll params metadata', {
    flowId: params.flowId,
    metadataKeys: Object.keys(params.metadata),
    hasExpectedAmountUusdc: 'expectedAmountUusdc' in params.metadata,
    hasNamadaReceiver: 'namadaReceiver' in params.metadata,
    hasForwardingAddress: 'forwardingAddress' in params.metadata,
    expectedAmountUusdc: params.metadata.expectedAmountUusdc,
    namadaReceiver: params.metadata.namadaReceiver,
    forwardingAddress: params.metadata.forwardingAddress,
    fullMetadata: params.metadata,
  })
  const timeoutMs = params.timeoutMs ?? 30 * 60 * 1000
  const txSearchTimeoutMs = 2 * 60 * 1000 // 2 minutes for tx_search
  const txSearchIntervalMs = 3000 // 3 seconds
  const { controller, cleanup } = createPollTimeout(
    timeoutMs,
    params.flowId,
    params.abortSignal,
  )
  const abortSignal = params.abortSignal || controller.signal

  logger.info('[NoblePoller] Starting Noble deposit polling with CCTP nonce', {
    flowId: params.flowId,
    cctpNonce: params.metadata.cctpNonce,
    forwardingAddress: params.metadata.forwardingAddress,
  })

  const stages: ChainStage[] = [
    {
      stage: DEPOSIT_STAGES.NOBLE_POLLING,
      status: 'pending',
      source: 'poller',
      occurredAt: new Date().toISOString(),
    },
  ]

  try {
    // Step 1: Search for CCTP mint event by nonce using tx_search
    // If cctpBlockHeight is already in metadata (from previous run), we can skip the search
    // but we still need cctpTx for logging/verification
    const existingCctpBlockHeight = params.metadata.cctpBlockHeight as number | undefined
    
    const query = `circle.cctp.v1.MessageReceived.nonce='\\"${params.metadata.cctpNonce}\\"'`
    logger.debug('[NoblePoller] Searching for CCTP mint event', {
      flowId: params.flowId,
      query,
      cctpNonce: params.metadata.cctpNonce,
      existingCctpBlockHeight,
      skipSearch: existingCctpBlockHeight !== undefined,
    })

    const txSearchDeadline = Date.now() + txSearchTimeoutMs
    let cctpTx: TendermintTx | null = null
    let cctpBlockHeight: number | null = existingCctpBlockHeight || null

    // If we already have cctpBlockHeight from metadata, skip the search loop
    if (existingCctpBlockHeight) {
      logger.info('[NoblePoller] Using existing cctpBlockHeight from metadata, skipping tx_search', {
        flowId: params.flowId,
        cctpBlockHeight: existingCctpBlockHeight,
      })
    } else {
      // Search for CCTP mint event
      while (Date.now() < txSearchDeadline) {
      if (isAborted(abortSignal)) {
        cleanup()
        return createErrorResult('polling_error', 'Polling aborted')
      }

      try {
        const txs = await retryWithBackoff(
          () => rpcClient.searchTransactions(query, 1, 1, abortSignal),
          3,
          500,
          5000,
          abortSignal,
        )

        if (txs.length > 0) {
          const tx = txs[0]

          // Verify the transaction has the MessageReceived event with matching nonce
          const txResult = (tx as any).tx_result || (tx as any).result
          const events = txResult?.events || []

          let nonceMatched = false
          for (const event of events) {
            if (event.type === 'circle.cctp.v1.MessageReceived') {
              const attrs = indexAttributes(event.attributes || [])
              const eventNonce = stripQuotes(attrs['nonce'])
              if (eventNonce === String(params.metadata.cctpNonce)) {
                nonceMatched = true
                break
              }
            }
          }

          if (nonceMatched) {
            cctpTx = tx
            cctpBlockHeight = Number.parseInt(tx.height, 10)
            logger.info('[NoblePoller] CCTP mint event found via tx_search', {
              flowId: params.flowId,
              cctpNonce: params.metadata.cctpNonce,
              blockHeight: cctpBlockHeight,
              txHash: tx.hash,
            })

            // Extract block metadata (height, timestamp, tx hash)
            let blockMetadata: { blockHeight?: number | string; blockTimestamp?: number; eventTxHash?: string } = {}
            try {
              blockMetadata = await extractTendermintBlockMetadata(
                rpcClient,
                cctpBlockHeight,
                tx.hash,
                params.abortSignal,
              )
            } catch (error) {
              // Log warning but continue - block metadata extraction failure shouldn't break polling
              logger.warn('[NoblePoller] Failed to extract block metadata for deposit', {
                flowId: params.flowId,
                blockHeight: cctpBlockHeight,
                txHash: tx.hash,
                error: error instanceof Error ? error.message : String(error),
              })
            }

            // Update NOBLE_POLLING stage to confirmed
            stages[0] = {
              stage: DEPOSIT_STAGES.NOBLE_POLLING,
              status: 'confirmed',
              source: 'poller',
              occurredAt: new Date().toISOString(),
            }

            stages.push({
              stage: DEPOSIT_STAGES.NOBLE_CCTP_MINTED,
              status: 'confirmed',
              source: 'poller',
              txHash: tx.hash,
              occurredAt: new Date().toISOString(),
              // Add block metadata to stage metadata
              metadata: Object.keys(blockMetadata).length > 0 ? blockMetadata : undefined,
            })

            // After CCTP minted, add forwarding registration stage (pending - will be confirmed when registration completes)
            stages.push({
              stage: DEPOSIT_STAGES.NOBLE_FORWARDING_REGISTRATION,
              status: 'pending',
              source: 'poller',
              occurredAt: new Date().toISOString(),
              message: 'Waiting for Noble forwarding registration',
            })
            break
          }
        }
      } catch (error) {
        // CRITICAL: Check abort signal FIRST - this takes absolute priority
        // Even if the error is a regular RPC error, if we're cancelled, we must stop
        if (isAborted(abortSignal)) {
          logger.info('[NoblePoller] Abort signal detected in catch block (PRIORITY CHECK), stopping polling immediately', {
            flowId: params.flowId,
            errorType: error instanceof Error ? error.constructor.name : typeof error,
            errorMessage: error instanceof Error ? error.message : String(error),
            errorName: error instanceof Error ? error.name : 'N/A',
          })
          cleanup()
          return createErrorResult('polling_error', 'Polling aborted')
        }

        // Check if error is due to cancellation (AbortError from fetch or our cancellation)
        const isAbortError =
          (error instanceof Error && error.name === 'AbortError') ||
          (error instanceof DOMException && error.name === 'AbortError') ||
          (error instanceof Error && error.message === 'Polling cancelled') ||
          (error instanceof Error && error.message.includes('cancelled'))

        if (isAbortError) {
          logger.info('[NoblePoller] Request cancelled (AbortError detected), stopping polling', {
            flowId: params.flowId,
            errorName: error instanceof Error ? error.name : typeof error,
            errorMessage: error instanceof Error ? error.message : String(error),
          })
          cleanup()
          return createErrorResult('polling_error', 'Polling aborted')
        }

        // Only log and continue if NOT cancelled
        logger.warn('[NoblePoller] tx_search request failed, will check abort before retrying', {
          flowId: params.flowId,
          error: error instanceof Error ? error.message : String(error),
          query,
          abortSignalAborted: abortSignal?.aborted,
        })
      }

      // Check abort signal before sleeping - CRITICAL CHECKPOINT
      if (isAborted(abortSignal)) {
        logger.info('[NoblePoller] Abort signal detected before sleep (CRITICAL CHECKPOINT), stopping polling', {
          flowId: params.flowId,
        })
        cleanup()
        return createErrorResult('polling_error', 'Polling aborted')
      }

      // Sleep with abort signal check
      try {
        await sleep(txSearchIntervalMs, abortSignal)
      } catch (sleepError) {
        // If sleep was aborted, return early
        if (sleepError instanceof Error && sleepError.message === 'Polling cancelled') {
          cleanup()
          return createErrorResult('polling_error', 'Polling aborted')
        }
      }
      } // Close while loop
    } // Close else block

    // If we skipped search but have blockHeight from metadata, we still need to verify
    // For now, if we have blockHeight, we'll proceed (the block_results query will verify)
    if (!cctpBlockHeight) {
      cleanup()
      return createErrorResult(
        'polling_timeout',
        `CCTP mint event not found for nonce ${params.metadata.cctpNonce} within ${txSearchTimeoutMs}ms`,
      )
    }
    
    // If we have blockHeight but no tx (from metadata), log a warning but continue
    if (!cctpTx && existingCctpBlockHeight) {
      logger.info('[NoblePoller] Using cctpBlockHeight from metadata without tx verification', {
        flowId: params.flowId,
        cctpBlockHeight: existingCctpBlockHeight,
      })
    }

    // Step 2: Trigger Noble forwarding registration (stub - returns failed for now)
    logger.info('[NoblePoller] CCTP mint found, triggering Noble forwarding registration', {
      flowId: params.flowId,
      blockHeight: cctpBlockHeight,
    })

    // Import registration service
    const { executeRegistrationJob } = await import('./nobleForwardingRegistration')
    
    // Get transaction ID from flowId (flowId should be the txId)
    const txId = params.flowId
    
    // Get forwarding address - fetch on-demand if missing
    let forwardingAddress = params.metadata.forwardingAddress as string | undefined
    const recipientAddress = params.metadata.namadaReceiver as string | undefined
    
    if (!forwardingAddress && recipientAddress) {
      logger.info('[NoblePoller] Forwarding address missing from metadata, fetching on-demand', {
        flowId: params.flowId,
        recipientAddress: recipientAddress.slice(0, 16) + '...',
      })
      try {
        forwardingAddress = await fetchNobleForwardingAddress(recipientAddress)
        logger.info('[NoblePoller] Successfully fetched forwarding address on-demand', {
          flowId: params.flowId,
          forwardingAddress: forwardingAddress.slice(0, 16) + '...',
        })
      } catch (error) {
        logger.error('[NoblePoller] Failed to fetch forwarding address on-demand', {
          flowId: params.flowId,
          error: error instanceof Error ? error.message : String(error),
        })
        // Continue without forwarding address - registration will fail gracefully later
      }
    }
    
    if (!forwardingAddress) {
      logger.error('[NoblePoller] Cannot proceed with registration - forwarding address unavailable', {
        flowId: params.flowId,
        hasForwardingAddressInMetadata: !!params.metadata.forwardingAddress,
        hasRecipientAddress: !!recipientAddress,
      })
      
      // Update forwarding registration stage with error
      const regStageIndex = stages.findIndex(
        (s) => s.stage === DEPOSIT_STAGES.NOBLE_FORWARDING_REGISTRATION,
      )
      if (regStageIndex >= 0) {
        stages[regStageIndex] = {
          stage: DEPOSIT_STAGES.NOBLE_FORWARDING_REGISTRATION,
          status: 'pending',
          source: 'poller',
          occurredAt: stages[regStageIndex]?.occurredAt || new Date().toISOString(),
          message: 'Forwarding address unavailable - cannot register',
        }
      }
      
      cleanup()
      return createErrorResult(
        'user_action_required',
        'Forwarding address unavailable - cannot proceed with registration',
      )
    }
    
    // Execute registration job
    const registrationResult = await executeRegistrationJob({
      txId,
      forwardingAddress,
      recipientAddress: recipientAddress || '',
      channelId: params.metadata.channelId as string | undefined,
      fallback: params.metadata.fallback as string | undefined,
      abortSignal: params.abortSignal,
    })

    // Update forwarding registration stage based on result
    const regStageIndex = stages.findIndex(
      (s) => s.stage === DEPOSIT_STAGES.NOBLE_FORWARDING_REGISTRATION,
    )

    // Track whether registration happened during flow (needed for packet extraction fallback)
    const registrationHappenedDuringFlow = registrationResult.success && !registrationResult.alreadyRegistered
    
    if (registrationResult.success) {
      // Registration succeeded (either already registered or newly registered)
      if (regStageIndex >= 0) {
        stages[regStageIndex] = {
          stage: DEPOSIT_STAGES.NOBLE_FORWARDING_REGISTRATION,
          status: 'confirmed',
          source: 'poller',
          txHash: registrationResult.registrationTx.txHash,
          occurredAt: stages[regStageIndex]?.occurredAt || new Date().toISOString(), // Preserve original timestamp
        }
      }
      
      logger.info('[NoblePoller] Noble forwarding registration completed', {
        flowId: params.flowId,
        alreadyRegistered: registrationResult.alreadyRegistered,
        registrationHappenedDuringFlow,
        txHash: registrationResult.registrationTx.txHash,
      })
    } else {
      // Registration requires user action - update stage to indicate user action needed
      const regStageIndex = stages.findIndex(
        (s) => s.stage === DEPOSIT_STAGES.NOBLE_FORWARDING_REGISTRATION,
      )
      if (regStageIndex >= 0) {
        stages[regStageIndex] = {
          stage: DEPOSIT_STAGES.NOBLE_FORWARDING_REGISTRATION,
          status: 'pending', // Keep as pending to indicate action needed
          source: 'poller',
          occurredAt: stages[regStageIndex]?.occurredAt || new Date().toISOString(), // Preserve original timestamp
          message: registrationResult.metadata.errorMessage || 'Forwarding registration requires user action',
          metadata: {
            error: registrationResult.metadata.errorMessage,
            balanceCheck: registrationResult.balanceCheck,
            registrationTx: registrationResult.registrationTx,
          },
        }
      }

      // Return user_action_required result - preserve all completed stages
      // Extract packet sequence before returning (if available)
      let packetSequence: number | undefined
      
      // Try to get block_results to extract packet sequence
      try {
        const blockResults = await retryWithBackoff(
          () => rpcClient.getBlockResults(cctpBlockHeight!, abortSignal),
          3,
          500,
          5000,
          abortSignal,
        )

        if (blockResults) {
          const finalizeEvents = blockResults.finalize_block_events || []
          for (const event of finalizeEvents) {
            if (event.type === 'send_packet') {
              const attrs = indexAttributes(event.attributes || [])
              const packetSequenceAttr = attrs['packet_sequence']
              if (packetSequenceAttr) {
                packetSequence = Number.parseInt(packetSequenceAttr, 10)
                logger.info('[NoblePoller] Extracted packet_sequence before returning user_action_required', {
                  flowId: params.flowId,
                  packetSequence,
                })
                break
              }
            }
          }
        }
      } catch (error) {
        logger.warn('[NoblePoller] Failed to extract packet_sequence before returning user_action_required', {
          flowId: params.flowId,
          error: error instanceof Error ? error.message : String(error),
        })
      }

      cleanup()
      // Return result with user_action_required status, preserving all stages and metadata
      return {
        success: false,
        found: true, // We found the CCTP mint, just need user action
        metadata: {
          ...params.metadata,
          cctpBlockHeight: cctpBlockHeight,
          packetSequence, // Include if we extracted it
        },
        stages, // Preserve all stages including completed ones
        height: cctpBlockHeight,
        error: {
          type: 'user_action_required',
          message: `Noble forwarding registration requires user action: ${registrationResult.metadata.errorMessage || 'Unknown error'}`,
          occurredAt: Date.now(),
        },
      }
    }

    // Step 3: Get block_results at the found height and extract IBC packet sequence
    // CRITICAL: Use cctpBlockHeight from metadata if available (for retry scenarios)
    const blockHeightForPacketExtraction = (params.metadata.cctpBlockHeight as number) || cctpBlockHeight
    
    logger.info('[NoblePoller] Fetching block_results to find IBC send_packet event', {
      flowId: params.flowId,
      cctpBlockHeightFromSearch: cctpBlockHeight,
      cctpBlockHeightFromMetadata: params.metadata.cctpBlockHeight,
      blockHeightForPacketExtraction,
    })

    const blockResults = await retryWithBackoff(
      () => rpcClient.getBlockResults(blockHeightForPacketExtraction!, abortSignal),
      3,
      500,
      5000,
      abortSignal,
    )

    if (!blockResults) {
      logger.error('[NoblePoller] Block results not found for packet extraction', {
        flowId: params.flowId,
        blockHeight: blockHeightForPacketExtraction,
        cctpBlockHeightFromSearch: cctpBlockHeight,
        cctpBlockHeightFromMetadata: params.metadata.cctpBlockHeight,
      })
      cleanup()
      return createErrorResult(
        'polling_error',
        `Block results not found for height ${blockHeightForPacketExtraction}`,
      )
    }

    // Extract packet sequence from send_packet events (even if packet_data doesn't match exactly)
    const finalizeEvents = blockResults.finalize_block_events || []
    logger.debug('[NoblePoller] Block results retrieved for packet extraction', {
      flowId: params.flowId,
      blockHeight: blockHeightForPacketExtraction,
      finalizeEventsCount: finalizeEvents.length,
      eventTypes: finalizeEvents.map((e) => e.type),
    })
    
    let packetSequence: number | undefined
    let forwardFound = false

    // First, try to find matching packet_data if we have the required params
    if (
      params.metadata.expectedAmountUusdc &&
      params.metadata.namadaReceiver &&
      params.metadata.forwardingAddress
    ) {
      const amountValue = params.metadata.expectedAmountUusdc.replace('uusdc', '')
      const expectedPacketData = JSON.stringify({
        amount: amountValue,
        denom: 'uusdc',
        receiver: params.metadata.namadaReceiver,
        sender: params.metadata.forwardingAddress,
      })

      logger.debug('[NoblePoller] Searching for send_packet event with matching packet_data', {
        flowId: params.flowId,
        expectedPacketData,
      })

      const foundPacketData: Array<{ packetData: string; packetSequence: string }> = []
      
      for (const event of finalizeEvents) {
        if (event.type === 'send_packet') {
          const attrs = indexAttributes(event.attributes || [])
          const packetDataAttr = attrs['packet_data']
          const packetSequenceAttr = attrs['packet_sequence']

          // Collect all packet_data values for logging
          if (packetDataAttr && packetSequenceAttr) {
            foundPacketData.push({
              packetData: packetDataAttr,
              packetSequence: packetSequenceAttr,
            })
          }

          if (packetDataAttr === expectedPacketData && packetSequenceAttr) {
            packetSequence = Number.parseInt(packetSequenceAttr, 10)
            forwardFound = true
            logger.info('[NoblePoller] IBC send_packet event found with matching packet_data', {
              flowId: params.flowId,
              blockHeight: blockHeightForPacketExtraction,
              packetSequence,
              packetData: expectedPacketData,
            })

            // Extract block metadata (height, timestamp, tx hash)
            // Note: IBC forwarded event may be in a different block than CCTP mint
            let blockMetadata: { blockHeight?: number | string; blockTimestamp?: number; eventTxHash?: string } = {}
            try {
              // For IBC forwarded event, we may not have a specific tx hash (it's in finalize_block_events)
              // But we can still extract block height and timestamp
              blockMetadata = await extractTendermintBlockMetadata(
                rpcClient,
                blockHeightForPacketExtraction,
                '', // No specific tx hash for IBC forwarded event in finalize_block_events
                params.abortSignal,
              )
              // Remove empty tx hash if extraction didn't provide one
              if (!blockMetadata.eventTxHash) {
                delete blockMetadata.eventTxHash
              }
            } catch (error) {
              // Log warning but continue - block metadata extraction failure shouldn't break polling
              logger.warn('[NoblePoller] Failed to extract block metadata for IBC forwarded event (CCTP block)', {
                flowId: params.flowId,
                blockHeight: blockHeightForPacketExtraction,
                error: error instanceof Error ? error.message : String(error),
              })
            }

            stages.push({
              stage: DEPOSIT_STAGES.NOBLE_IBC_FORWARDED,
              status: 'confirmed',
              source: 'poller',
              occurredAt: new Date().toISOString(),
              // Add block metadata to stage metadata
              metadata: Object.keys(blockMetadata).length > 0 ? blockMetadata : undefined,
            })
            break
          }
        }
      }

      // Log comparison if no exact match found
      if (!forwardFound && foundPacketData.length > 0) {
        logger.debug('[NoblePoller] Packet_data comparison (no exact match found)', {
          flowId: params.flowId,
          blockHeight: cctpBlockHeight,
          expectedPacketData,
          foundPacketData: foundPacketData.map((p) => ({
            packetData: p.packetData,
            packetSequence: p.packetSequence,
            matches: p.packetData === expectedPacketData,
          })),
          expectedLength: expectedPacketData.length,
          foundLengths: foundPacketData.map((p) => p.packetData.length),
        })
      }
    }

    // If no exact match found, try to extract packet sequence from any send_packet event
    // (This might happen if packet_data format differs slightly)
    if (!packetSequence) {
      logger.debug('[NoblePoller] No exact packet_data match found, trying fallback extraction', {
        flowId: params.flowId,
        blockHeight: blockHeightForPacketExtraction,
        finalizeEventsCount: finalizeEvents.length,
        sendPacketEventsCount: finalizeEvents.filter((e) => e.type === 'send_packet').length,
      })
      
      for (const event of finalizeEvents) {
        if (event.type === 'send_packet') {
          const attrs = indexAttributes(event.attributes || [])
          const packetSequenceAttr = attrs['packet_sequence']
          const packetDataAttr = attrs['packet_data']
          if (packetSequenceAttr) {
            packetSequence = Number.parseInt(packetSequenceAttr, 10)
            logger.info('[NoblePoller] Extracted packet_sequence from send_packet event (fallback)', {
              flowId: params.flowId,
              blockHeight: blockHeightForPacketExtraction,
              packetSequence,
              packetData: packetDataAttr || 'not available',
            })
            break
          }
        }
      }
      
      if (!packetSequence) {
        logger.warn('[NoblePoller] Failed to extract packet_sequence from any send_packet event in CCTP block', {
          flowId: params.flowId,
          blockHeight: blockHeightForPacketExtraction,
          finalizeEventsCount: finalizeEvents.length,
          sendPacketEventsCount: finalizeEvents.filter((e) => e.type === 'send_packet').length,
          eventTypes: finalizeEvents.map((e) => e.type),
        })
        
        // FALLBACK: When packet not found in CCTP block, try searching the registration block
        // The IBC packet might be in the AccountRegistered event block instead
        // Always try this fallback regardless of registration status for robustness
        if (recipientAddress) {
          logger.info('[NoblePoller] Packet not found in CCTP block - searching AccountRegistered event block (fallback)', {
            flowId: params.flowId,
            recipientAddress: recipientAddress.slice(0, 16) + '...',
            registrationHappenedDuringFlow,
            note: 'IBC packet may be in registration block instead of CCTP block',
          })
          
          try {
            // Search for AccountRegistered event using tx_search with polling
            // Format: noble.forwarding.v1.AccountRegistered.recipient='\"<recipient>\"'
            // CRITICAL: Polling indexing may lag, so we need to poll until found or timeout
            const accountRegisteredQuery = `noble.forwarding.v1.AccountRegistered.recipient='\\"${recipientAddress}\\"'`
            const accountRegisteredSearchTimeoutMs = 2 * 60 * 1000 // 2 minutes for tx_search
            const accountRegisteredSearchIntervalMs = 3000 // 3 seconds
            const accountRegisteredSearchDeadline = Date.now() + accountRegisteredSearchTimeoutMs
            
            logger.info('[NoblePoller] Polling for AccountRegistered event (transaction indexing may lag)', {
              flowId: params.flowId,
              query: accountRegisteredQuery,
              recipientAddress: recipientAddress.slice(0, 16) + '...',
              timeoutMs: accountRegisteredSearchTimeoutMs,
              intervalMs: accountRegisteredSearchIntervalMs,
            })
            
            let regTx: TendermintTx | null = null
            let registrationBlockHeight: number | null = null
            
            // Poll until found or timeout
            while (Date.now() < accountRegisteredSearchDeadline) {
              if (isAborted(abortSignal)) {
                logger.info('[NoblePoller] Abort signal detected while polling for AccountRegistered event', {
                  flowId: params.flowId,
                })
                break
              }
              
              try {
                const registrationTxs = await retryWithBackoff(
                  () => rpcClient.searchTransactions(accountRegisteredQuery, 1, 1, abortSignal),
                  3,
                  500,
                  5000,
                  abortSignal,
                )
                
                if (registrationTxs.length > 0) {
                  regTx = registrationTxs[0]
                  registrationBlockHeight = Number.parseInt(regTx.height, 10)
                  
                  logger.info('[NoblePoller] AccountRegistered event found - querying block_results for packet extraction', {
                    flowId: params.flowId,
                    registrationBlockHeight,
                    txHash: regTx.hash,
                    recipientAddress: recipientAddress.slice(0, 16) + '...',
                    attempts: Math.floor((Date.now() - (accountRegisteredSearchDeadline - accountRegisteredSearchTimeoutMs)) / accountRegisteredSearchIntervalMs) + 1,
                  })
                  break
                } else {
                  logger.debug('[NoblePoller] AccountRegistered event not yet indexed, will retry', {
                    flowId: params.flowId,
                    recipientAddress: recipientAddress.slice(0, 16) + '...',
                    timeRemaining: accountRegisteredSearchDeadline - Date.now(),
                  })
                }
              } catch (error) {
                // Check abort signal first
                if (isAborted(abortSignal)) {
                  logger.info('[NoblePoller] Abort signal detected in AccountRegistered search catch block', {
                    flowId: params.flowId,
                  })
                  break
                }
                
                logger.warn('[NoblePoller] AccountRegistered tx_search request failed, will retry', {
                  flowId: params.flowId,
                  error: error instanceof Error ? error.message : String(error),
                  query: accountRegisteredQuery,
                })
              }
              
              // Check abort signal before sleeping
              if (isAborted(abortSignal)) {
                break
              }
              
              // Sleep before next attempt
              try {
                await sleep(accountRegisteredSearchIntervalMs, abortSignal)
              } catch (sleepError) {
                if (sleepError instanceof Error && sleepError.message === 'Polling cancelled') {
                  break
                }
              }
            }
            
            if (!regTx || !registrationBlockHeight) {
              logger.warn('[NoblePoller] AccountRegistered event not found within timeout', {
                flowId: params.flowId,
                recipientAddress: recipientAddress.slice(0, 16) + '...',
                timeoutMs: accountRegisteredSearchTimeoutMs,
                note: 'Transaction may not be indexed yet, or registration may have failed',
              })
              // Continue without registration block - packet extraction will fail gracefully
            } else {
              
              // Query block_results for registration block
              const registrationBlockResults = await retryWithBackoff(
                () => rpcClient.getBlockResults(registrationBlockHeight!, abortSignal),
                3,
                500,
                5000,
                abortSignal,
              )
              
              if (registrationBlockResults) {
                const registrationFinalizeEvents = registrationBlockResults.finalize_block_events || []
                logger.debug('[NoblePoller] Block results retrieved for registration block', {
                  flowId: params.flowId,
                  blockHeight: registrationBlockHeight,
                  finalizeEventsCount: registrationFinalizeEvents.length,
                  eventTypes: registrationFinalizeEvents.map((e) => e.type),
                })
                
                // Try to find matching packet_data first
                if (
                  params.metadata.expectedAmountUusdc &&
                  params.metadata.namadaReceiver &&
                  params.metadata.forwardingAddress
                ) {
                  const amountValue = params.metadata.expectedAmountUusdc.replace('uusdc', '')
                  const expectedPacketData = JSON.stringify({
                    amount: amountValue,
                    denom: 'uusdc',
                    receiver: params.metadata.namadaReceiver,
                    sender: params.metadata.forwardingAddress,
                  })
                  
                  for (const event of registrationFinalizeEvents) {
                    if (event.type === 'send_packet') {
                      const attrs = indexAttributes(event.attributes || [])
                      const packetDataAttr = attrs['packet_data']
                      const packetSequenceAttr = attrs['packet_sequence']
                      
                      if (packetDataAttr === expectedPacketData && packetSequenceAttr) {
                        packetSequence = Number.parseInt(packetSequenceAttr, 10)
                        forwardFound = true
                        logger.info('[NoblePoller] IBC send_packet event found with matching packet_data in registration block', {
                          flowId: params.flowId,
                          blockHeight: registrationBlockHeight,
                          packetSequence,
                          packetData: expectedPacketData,
                        })
                        
                        // Extract block metadata (height, timestamp, tx hash)
                        // IBC forwarded event is in registration block (may be different from CCTP mint block)
                        let blockMetadata: { blockHeight?: number | string; blockTimestamp?: number; eventTxHash?: string } = {}
                        try {
                          // We have the registration tx hash available
                          blockMetadata = await extractTendermintBlockMetadata(
                            rpcClient,
                            registrationBlockHeight!,
                            regTx!.hash,
                            params.abortSignal,
                          )
                        } catch (error) {
                          // Log warning but continue - block metadata extraction failure shouldn't break polling
                          logger.warn('[NoblePoller] Failed to extract block metadata for IBC forwarded event (registration block)', {
                            flowId: params.flowId,
                            blockHeight: registrationBlockHeight,
                            txHash: regTx!.hash,
                            error: error instanceof Error ? error.message : String(error),
                          })
                        }
                        
                        stages.push({
                          stage: DEPOSIT_STAGES.NOBLE_IBC_FORWARDED,
                          status: 'confirmed',
                          source: 'poller',
                          occurredAt: new Date().toISOString(),
                          // Add block metadata to stage metadata
                          metadata: Object.keys(blockMetadata).length > 0 ? blockMetadata : undefined,
                        })
                        break
                      }
                    }
                  }
                }
                
                // Fallback: extract packet sequence from any send_packet event
                if (!packetSequence) {
                  for (const event of registrationFinalizeEvents) {
                    if (event.type === 'send_packet') {
                      const attrs = indexAttributes(event.attributes || [])
                      const packetSequenceAttr = attrs['packet_sequence']
                      const packetDataAttr = attrs['packet_data']
                      if (packetSequenceAttr) {
                        packetSequence = Number.parseInt(packetSequenceAttr, 10)
                        logger.info('[NoblePoller] Extracted packet_sequence from send_packet event in registration block (fallback)', {
                          flowId: params.flowId,
                          blockHeight: registrationBlockHeight,
                          packetSequence,
                          packetData: packetDataAttr || 'not available',
                        })
                        break
                      }
                    }
                  }
                }
                
                if (packetSequence) {
                  logger.info('[NoblePoller] Successfully extracted packet_sequence from registration block', {
                    flowId: params.flowId,
                    registrationBlockHeight,
                    packetSequence,
                    cctpBlockHeight,
                  })
                } else {
                  logger.warn('[NoblePoller] Failed to extract packet_sequence from registration block', {
                    flowId: params.flowId,
                    registrationBlockHeight,
                    finalizeEventsCount: registrationFinalizeEvents.length,
                    sendPacketEventsCount: registrationFinalizeEvents.filter((e) => e.type === 'send_packet').length,
                  })
                }
              } else {
                logger.warn('[NoblePoller] Block results not found for registration block', {
                  flowId: params.flowId,
                  registrationBlockHeight,
                })
              }
            }
          } catch (error) {
            logger.warn('[NoblePoller] Failed to search for AccountRegistered event or extract packet from registration block', {
              flowId: params.flowId,
              error: error instanceof Error ? error.message : String(error),
              recipientAddress: recipientAddress.slice(0, 16) + '...',
            })
          }
        }
      }
    }

    if (!forwardFound && packetSequence) {
      // Reconstruct expectedPacketData for logging (if metadata available)
      let expectedPacketDataForLog: string | undefined
      if (
        params.metadata.expectedAmountUusdc &&
        params.metadata.namadaReceiver &&
        params.metadata.forwardingAddress
      ) {
        const amountValue = params.metadata.expectedAmountUusdc.replace('uusdc', '')
        expectedPacketDataForLog = JSON.stringify({
          amount: amountValue,
          denom: 'uusdc',
          receiver: params.metadata.namadaReceiver,
          sender: params.metadata.forwardingAddress,
        })
      }

      logger.warn('[NoblePoller] CCTP mint found and packet_sequence extracted, but exact packet_data match not found', {
        flowId: params.flowId,
        blockHeight: cctpBlockHeight,
        packetSequence,
        expectedPacketData: expectedPacketDataForLog || 'not available (missing metadata)',
        note: 'Check debug logs above for actual packet_data values found in block',
      })
    }

    cleanup()
    return {
      success: true,
      found: true,
      metadata: {
        ...params.metadata,
        cctpBlockHeight: cctpBlockHeight,
        packetSequence,
      },
      stages,
      height: cctpBlockHeight,
    }
  } catch (error) {
    cleanup()

    if (isAborted(abortSignal)) {
      return createErrorResult('polling_error', 'Polling cancelled')
    }

    logger.error('[NoblePoller] Noble deposit poll with nonce error', {
      flowId: params.flowId,
      error: error instanceof Error ? error.message : String(error),
      cctpNonce: params.metadata.cctpNonce,
    })

    return createErrorResult(
      'polling_error',
      error instanceof Error ? error.message : 'Unknown error',
    )
  }
}

/**
 * Poll for payment flow: IBC acknowledgement by packet sequence, then CCTP burn
 */
async function pollForPaymentWithPacketSequence(
  params: ChainPollParams,
  rpcClient: ReturnType<typeof createTendermintRpcClient>,
): Promise<ChainPollResult> {
  const timeoutMs = params.timeoutMs ?? 30 * 60 * 1000
  const txSearchTimeoutMs = 2 * 60 * 1000 // 2 minutes for tx_search
  const txSearchIntervalMs = 3000 // 3 seconds
  const { controller, cleanup } = createPollTimeout(
    timeoutMs,
    params.flowId,
    params.abortSignal,
  )
  const abortSignal = params.abortSignal || controller.signal

  logger.info('[NoblePoller] Starting Noble payment polling with packet_sequence', {
    flowId: params.flowId,
    packetSequence: params.metadata.packetSequence,
  })

  const stages: ChainStage[] = [
    {
      stage: PAYMENT_STAGES.NOBLE_POLLING,
      status: 'pending',
      source: 'poller',
      occurredAt: new Date().toISOString(),
    },
  ]

  try {
    // Step 1: Search for write_acknowledgement event by packet_sequence using tx_search
    const query = `write_acknowledgement.packet_sequence='${params.metadata.packetSequence}'`
    logger.debug('[NoblePoller] Searching for write_acknowledgement event', {
      flowId: params.flowId,
      query,
      packetSequence: params.metadata.packetSequence,
    })

    const txSearchDeadline = Date.now() + txSearchTimeoutMs
    let ackTx: TendermintTx | null = null
    let ackBlockHeight: number | null = null

    while (Date.now() < txSearchDeadline) {
      if (isAborted(abortSignal)) {
        cleanup()
        return createErrorResult('polling_error', 'Polling aborted')
      }

      try {
        const txs = await retryWithBackoff(
          () => rpcClient.searchTransactions(query, 1, 1, abortSignal),
          3,
          500,
          5000,
          abortSignal,
        )

        if (txs.length > 0) {
          const tx = txs[0]

          // Verify the transaction has the write_acknowledgement event with matching packet_sequence
          const txResult = (tx as any).tx_result || (tx as any).result
          const events = txResult?.events || []

          let packetSeqMatched = false
          let packetAck: string | undefined

          for (const event of events) {
            if (event.type === 'write_acknowledgement') {
              const attrs = indexAttributes(event.attributes || [])
              const eventPacketSeq = attrs['packet_sequence']
              packetAck = attrs['packet_ack']

              if (eventPacketSeq === String(params.metadata.packetSequence)) {
                packetSeqMatched = true
                break
              }
            }
          }

          if (packetSeqMatched) {
            // Verify packet_ack is success code
            if (packetAck !== '{"result":"AQ=="}') {
              logger.error('[NoblePoller] Packet acknowledgement indicates failure', {
                flowId: params.flowId,
                packetSequence: params.metadata.packetSequence,
                packetAck,
              })
              cleanup()
              return createErrorResult(
                'tx_error',
                `Packet acknowledgement indicates failure: ${packetAck}`,
              )
            }

            ackTx = tx
            ackBlockHeight = Number.parseInt(tx.height, 10)
            logger.info('[NoblePoller] write_acknowledgement event found via tx_search', {
              flowId: params.flowId,
              packetSequence: params.metadata.packetSequence,
              blockHeight: ackBlockHeight,
              txHash: tx.hash,
            })

            // Extract block metadata (height, timestamp, tx hash)
            let blockMetadata: { blockHeight?: number | string; blockTimestamp?: number; eventTxHash?: string } = {}
            try {
              blockMetadata = await extractTendermintBlockMetadata(
                rpcClient,
                ackBlockHeight,
                tx.hash,
                params.abortSignal,
              )
            } catch (error) {
              // Log warning but continue - block metadata extraction failure shouldn't break polling
              logger.warn('[NoblePoller] Failed to extract block metadata for payment', {
                flowId: params.flowId,
                blockHeight: ackBlockHeight,
                txHash: tx.hash,
                error: error instanceof Error ? error.message : String(error),
              })
            }

            // Update NOBLE_POLLING stage to confirmed
            stages[0] = {
              stage: PAYMENT_STAGES.NOBLE_POLLING,
              status: 'confirmed',
              source: 'poller',
              occurredAt: stages[0]?.occurredAt || new Date().toISOString(), // Preserve original timestamp
            }

            stages.push({
              stage: PAYMENT_STAGES.NOBLE_RECEIVED,
              status: 'confirmed',
              source: 'poller',
              txHash: tx.hash,
              occurredAt: new Date().toISOString(),
              // Add block metadata to stage metadata
              metadata: Object.keys(blockMetadata).length > 0 ? blockMetadata : undefined,
            })
            break
          }
        }
      } catch (error) {
        // CRITICAL: Check abort signal FIRST - this takes absolute priority
        // Even if the error is a regular RPC error, if we're cancelled, we must stop
        if (isAborted(abortSignal)) {
          logger.info('[NoblePoller] Abort signal detected in catch block (PRIORITY CHECK), stopping polling immediately', {
            flowId: params.flowId,
            errorType: error instanceof Error ? error.constructor.name : typeof error,
            errorMessage: error instanceof Error ? error.message : String(error),
            errorName: error instanceof Error ? error.name : 'N/A',
          })
          cleanup()
          return createErrorResult('polling_error', 'Polling aborted')
        }

        // Check if error is due to cancellation (AbortError from fetch or our cancellation)
        const isAbortError =
          (error instanceof Error && error.name === 'AbortError') ||
          (error instanceof DOMException && error.name === 'AbortError') ||
          (error instanceof Error && error.message === 'Polling cancelled') ||
          (error instanceof Error && error.message.includes('cancelled'))

        if (isAbortError) {
          logger.info('[NoblePoller] Request cancelled (AbortError detected), stopping polling', {
            flowId: params.flowId,
            errorName: error instanceof Error ? error.name : typeof error,
            errorMessage: error instanceof Error ? error.message : String(error),
          })
          cleanup()
          return createErrorResult('polling_error', 'Polling aborted')
        }

        // Only log and continue if NOT cancelled
        logger.warn('[NoblePoller] tx_search request failed, will check abort before retrying', {
          flowId: params.flowId,
          error: error instanceof Error ? error.message : String(error),
          query,
          abortSignalAborted: abortSignal?.aborted,
        })
      }

      // Check abort signal before sleeping - CRITICAL CHECKPOINT
      if (isAborted(abortSignal)) {
        logger.info('[NoblePoller] Abort signal detected before sleep (CRITICAL CHECKPOINT), stopping polling', {
          flowId: params.flowId,
        })
        cleanup()
        return createErrorResult('polling_error', 'Polling aborted')
      }

      // Sleep with abort signal check
      try {
        await sleep(txSearchIntervalMs, abortSignal)
      } catch (sleepError) {
        // If sleep was aborted, return early
        if (sleepError instanceof Error && sleepError.message === 'Polling cancelled') {
          cleanup()
          return createErrorResult('polling_error', 'Polling aborted')
        }
      }
    }

    if (!ackTx || !ackBlockHeight) {
      cleanup()
      return createErrorResult(
        'polling_timeout',
        `write_acknowledgement event not found for packet_sequence ${params.metadata.packetSequence} within ${txSearchTimeoutMs}ms`,
      )
    }

    // Step 2: Search for DepositForBurn event in the same transaction
    logger.debug('[NoblePoller] Searching for DepositForBurn event in transaction', {
      flowId: params.flowId,
      blockHeight: ackBlockHeight,
    })

    const txResult = (ackTx as any).tx_result || (ackTx as any).result
    const events = txResult?.events || []

    let cctpNonce: number | undefined
    let cctpFound = false

    for (const event of events) {
      if (event.type === 'circle.cctp.v1.DepositForBurn') {
        const attrs = indexAttributes(event.attributes || [])
        const nonceStr = stripQuotes(attrs['nonce'])

        if (nonceStr) {
          cctpNonce = Number.parseInt(nonceStr, 10)
          if (!cctpNonce || cctpNonce <= 0) {
            logger.warn('[NoblePoller] Invalid CCTP nonce value', {
              flowId: params.flowId,
              blockHeight: ackBlockHeight,
              nonceStr,
            })
            continue
          }

          cctpFound = true
          logger.info('[NoblePoller] CCTP DepositForBurn event found, nonce extracted', {
            flowId: params.flowId,
            blockHeight: ackBlockHeight,
            cctpNonce,
          })

          stages.push({
            stage: PAYMENT_STAGES.NOBLE_CCTP_BURNED,
            status: 'confirmed',
            source: 'poller',
            occurredAt: new Date().toISOString(),
          })
          break
        }
      }
    }

    if (!cctpFound) {
      logger.warn('[NoblePoller] write_acknowledgement found but DepositForBurn event not found', {
        flowId: params.flowId,
        blockHeight: ackBlockHeight,
        packetSequence: params.metadata.packetSequence,
      })
    }

    cleanup()
    return {
      success: true,
      found: true,
      metadata: {
        ...params.metadata,
        cctpNonce,
        ackBlockHeight: ackBlockHeight,
      },
      stages,
      height: ackBlockHeight,
    }
  } catch (error) {
    cleanup()

    if (isAborted(abortSignal)) {
      return createErrorResult('polling_error', 'Polling cancelled')
    }

    logger.error('[NoblePoller] Noble payment poll with packet_sequence error', {
      flowId: params.flowId,
      error: error instanceof Error ? error.message : String(error),
      packetSequence: params.metadata.packetSequence,
    })

    return createErrorResult(
      'polling_error',
      error instanceof Error ? error.message : 'Unknown error',
    )
  }
}

/**
 * Noble Chain Poller Implementation
 * Implements ChainPoller interface for modularity
 */
export class NoblePoller implements ChainPoller {
  /**
   * Poll Noble chain for CCTP/IBC events
   * 
   * @param params - Polling parameters
   * @returns Polling result with success status, metadata, and stages
   */
  async poll(params: ChainPollParams): Promise<ChainPollResult> {
    // Get Tendermint RPC client for Noble
    const chainKey = params.metadata.chainKey || 'noble-testnet'
    let rpcUrl: string
    try {
      rpcUrl = await getEffectiveRpcUrl(chainKey, 'tendermint')
    } catch (error) {
      logger.error('[NoblePoller] Failed to get Tendermint RPC URL', {
        chainKey,
        error: error instanceof Error ? error.message : String(error),
      })
      return createErrorResult(
        'polling_error',
        `Failed to get RPC URL for Noble chain: ${chainKey}`,
      )
    }

    const rpcClient = createTendermintRpcClient(rpcUrl)

    // Determine flow type based on available metadata
    // Deposit flow: has cctpNonce
    // Payment flow: has packetSequence
    const isDepositFlow = Boolean(params.metadata.cctpNonce)
    const isPaymentFlow = Boolean(params.metadata.packetSequence)

    if (isDepositFlow) {
      logger.info('[NoblePoller] Using deposit flow (nonce-based)', {
        flowId: params.flowId,
        cctpNonce: params.metadata.cctpNonce,
      })
      return pollForDepositWithNonce(params, rpcClient)
    } else if (isPaymentFlow) {
      logger.info('[NoblePoller] Using payment flow (packet sequence-based)', {
        flowId: params.flowId,
        packetSequence: params.metadata.packetSequence,
      })
      return pollForPaymentWithPacketSequence(params, rpcClient)
    } else {
      return createErrorResult(
        'polling_error',
        'Missing required metadata: either cctpNonce (deposit) or packetSequence (payment)',
      )
    }
  }
}

/**
 * Create Noble poller instance
 */
export function createNoblePoller(): ChainPoller {
  return new NoblePoller()
}

