/**
 * EVM Chain Poller
 * 
 * Polls EVM chains for USDC mint events (MessageReceived or Transfer events).
 * Implements ChainPoller interface for modularity.
 */

import { ethers } from 'ethers'
import type {
  ChainPoller,
  ChainPollParams,
  ChainPollResult,
  EvmPollParams,
} from './types'
import type { ChainStage } from '@/types/flow'
import {
  retryWithBackoff,
  createPollTimeout,
  isAborted,
  createErrorResult,
} from './basePoller'
import { getEvmProvider } from '@/services/evm/evmNetworkService'
import { logger } from '@/utils/logger'
import { DEPOSIT_STAGES, PAYMENT_STAGES } from '@/shared/flowStages'
import { extractMessageSent, pollIrisAttestation } from './irisAttestationService'
import type { MessageSentExtractionResult, IrisPollingResult } from './irisAttestationService'

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const DEFAULT_EVM_MAX_BLOCK_RANGE = 2000n

// MessageReceived event signature: keccak256("MessageReceived(address,uint32,uint64,bytes32,bytes)")
const MESSAGE_RECEIVED_TOPIC = '0x58200b4c34ae05ee816d710053fff3fb75af4395915d3d2a771b24aa10e3cc5d'

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Convert address to padded topic (32 bytes)
 */
function toPaddedTopicAddress(addr: string): string {
  const clean = addr.toLowerCase().replace(/^0x/, '')
  return `0x${clean.padStart(64, '0')}`
}

/**
 * Convert bigint to hex quantity
 */
function toHexQuantity(n: bigint): string {
  return `0x${n.toString(16)}`
}

/**
 * Convert nonce to padded hex topic for event filtering
 * Nonce is uint64, padded to 32 bytes (64 hex characters)
 */
function toPaddedNonceTopic(nonce: number): string {
  return `0x${BigInt(nonce).toString(16).padStart(64, '0')}`
}

/**
 * Extract EVM address from bytes32
 * EVM address is in the last 20 bytes of the bytes32 value
 */
function extractEvmAddressFromBytes32(bytes32: string): string {
  const clean = bytes32.replace(/^0x/, '')
  const addressHex = clean.slice(-40)
  return `0x${addressHex}`
}

/**
 * Parse MessageReceived event data
 * Event structure: MessageReceived(address indexed caller, uint32 sourceDomain, uint64 indexed nonce, bytes32 sender, bytes messageBody)
 */
interface ParsedMessageReceived {
  nonce: number
  sourceDomain: number
  sender: string
  mintRecipient: string
  amount: bigint
}

function parseMessageReceivedEvent(log: ethers.Log): ParsedMessageReceived | null {
  try {
    if (!log.topics || log.topics.length < 3 || !log.data) {
      return null
    }

    // Extract nonce from topics[2] (indexed uint64, padded to 32 bytes)
    const nonceTopic = log.topics[2]
    const nonce = Number(BigInt(nonceTopic))

    // Parse data field: ABI-encoded (uint32 sourceDomain, bytes32 sender, bytes messageBody)
    if (!log.data || log.data.length < 256) {
      return null
    }

    const dataHex = log.data
    // Use ethers.getBytes for browser compatibility
    const dataBytes = ethers.getBytes(dataHex)

    if (dataBytes.length < 128) {
      return null
    }

    // Extract sourceDomain (uint32 at offset 0, padded to 32 bytes)
    // Uint8Array doesn't have readUInt32BE, so we read bytes manually
    const sourceDomainBytes = dataBytes.slice(28, 32)
    const sourceDomain = Number(BigInt(ethers.hexlify(sourceDomainBytes)))

    // Extract sender (bytes32 at offset 32-63)
    const sender = ethers.hexlify(dataBytes.slice(32, 64))

    // Extract messageBody offset (uint256 at offset 64-95)
    const messageBodyOffsetBytes = dataBytes.slice(64, 96)
    const messageBodyOffset = Number(BigInt(ethers.hexlify(messageBodyOffsetBytes)))
    if (messageBodyOffset <= 0 || messageBodyOffset > dataBytes.length - 32) {
      return null
    }

    // Extract messageBody length
    const lengthStart = messageBodyOffset
    const lengthEnd = messageBodyOffset + 32
    if (lengthEnd > dataBytes.length) {
      return null
    }
    const messageBodyLengthBytes = dataBytes.slice(lengthStart, lengthEnd)
    const messageBodyLength = Number(BigInt(ethers.hexlify(messageBodyLengthBytes)))

    const bodyStart = lengthEnd
    const bodyEnd = bodyStart + messageBodyLength
    if (bodyEnd > dataBytes.length) {
      return null
    }

    // Extract messageBody bytes
    const messageBodyBytes = dataBytes.slice(bodyStart, bodyEnd)

    // Parse BurnMessage from messageBody
    // BurnMessage structure: version (4 bytes), burnToken (32 bytes), mintRecipient (32 bytes), amount (32 bytes), messageSender (32 bytes)
    if (messageBodyBytes.length < 132) {
      return null
    }

    // Extract mintRecipient (bytes32 at offset 36-67)
    const mintRecipientBytes32 = ethers.hexlify(messageBodyBytes.slice(36, 68))
    const mintRecipient = extractEvmAddressFromBytes32(mintRecipientBytes32)

    // Extract amount (uint256 at offset 68-99)
    const amountBytes = messageBodyBytes.slice(68, 100)
    const amount = BigInt(ethers.hexlify(amountBytes))

    return {
      nonce,
      sourceDomain,
      sender,
      mintRecipient,
      amount,
    }
  } catch (error) {
    logger.debug('[EvmPoller] Failed to parse MessageReceived event', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * Query MessageReceived events filtered by nonce
 */
async function queryMessageReceivedByNonce(
  provider: ethers.JsonRpcProvider,
  params: {
    messageTransmitterAddress: string
    nonce: number
    fromBlock?: bigint
    toBlock?: bigint
  },
): Promise<ethers.Log[]> {
  const nonceTopic = toPaddedNonceTopic(params.nonce)

  const filter: ethers.Filter = {
    address: params.messageTransmitterAddress.toLowerCase(),
    topics: [MESSAGE_RECEIVED_TOPIC, null, nonceTopic],
    fromBlock: params.fromBlock !== undefined ? toHexQuantity(params.fromBlock) : undefined,
    toBlock: params.toBlock !== undefined ? toHexQuantity(params.toBlock) : undefined,
  }

  logger.debug('[EvmPoller] Querying MessageReceived events by nonce', {
    messageTransmitterAddress: params.messageTransmitterAddress,
    nonce: params.nonce,
    fromBlock: params.fromBlock?.toString(),
    toBlock: params.toBlock?.toString(),
  })

  try {
    const logs = await provider.getLogs(filter)
    logger.debug('[EvmPoller] MessageReceived events found by nonce', {
      nonce: params.nonce,
      logCount: logs.length,
    })
    return logs
  } catch (error) {
    logger.warn('[EvmPoller] Failed to query MessageReceived events by nonce', {
      error: error instanceof Error ? error.message : String(error),
      nonce: params.nonce,
    })
    throw error
  }
}

/**
 * Nonce-based polling (efficient approach)
 * Finds MessageReceived event filtered by CCTP nonce
 */
async function pollUsdcMintByNonce(
  params: EvmPollParams,
  provider: ethers.JsonRpcProvider,
): Promise<ChainPollResult> {
  const timeoutMs = params.timeoutMs ?? 30 * 60 * 1000
  const intervalMs = params.intervalMs ?? 5000
  const { controller, cleanup, wasTimeout } = createPollTimeout(
    timeoutMs,
    params.flowId,
    params.abortSignal,
  )
  const abortSignal = params.abortSignal || controller.signal

  logger.info('[EvmPoller] Starting EVM mint polling with CCTP nonce', {
    flowId: params.flowId,
    cctpNonce: params.metadata.cctpNonce,
    messageTransmitterAddress: params.metadata.messageTransmitterAddress,
  })

  const stages: ChainStage[] = [
    {
      stage: PAYMENT_STAGES.EVM_MINT_POLLING,
      status: 'pending',
      source: 'poller',
      occurredAt: new Date().toISOString(),
    },
  ]

  try {
    const maxBlockRange =
      params.metadata.maxBlockRange && params.metadata.maxBlockRange > 0
        ? BigInt(params.metadata.maxBlockRange)
        : DEFAULT_EVM_MAX_BLOCK_RANGE

    let fromBlock = params.metadata.startBlock
      ? BigInt(params.metadata.startBlock)
      : undefined

    if (!fromBlock) {
      const latestBlock = await retryWithBackoff(
        () => provider.getBlockNumber(),
        3,
        500,
        5000,
        abortSignal,
      )
      fromBlock = latestBlock > 0 ? BigInt(latestBlock) - 1n : 0n
      logger.debug('[EvmPoller] Starting from latest block minus one', {
        flowId: params.flowId,
        fromBlock: fromBlock.toString(),
        latestBlock,
      })
    }

    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline && !isAborted(abortSignal)) {
      const latestNumber = await retryWithBackoff(
        () => provider.getBlockNumber(),
        3,
        500,
        5000,
        abortSignal,
      )
      const latest = BigInt(latestNumber)

      if (latest < fromBlock!) {
        await sleep(intervalMs)
        continue
      }

      // Query MessageReceived events by nonce in chunks
      let chunkStart = fromBlock!
      while (chunkStart <= latest) {
        if (isAborted(abortSignal)) break

        const chunkEndCandidate = chunkStart + maxBlockRange - 1n
        const chunkEnd = chunkEndCandidate < latest ? chunkEndCandidate : latest

        const logs = await retryWithBackoff(
          () =>
            queryMessageReceivedByNonce(provider, {
              messageTransmitterAddress: params.metadata.messageTransmitterAddress!,
              nonce: params.metadata.cctpNonce!,
              fromBlock: chunkStart,
              toBlock: chunkEnd,
            }),
          3,
          500,
          5000,
          abortSignal,
        )

        // Parse and verify each event
        for (const log of logs) {
          const parsed = parseMessageReceivedEvent(log)
          if (!parsed) {
            logger.debug('[EvmPoller] Failed to parse MessageReceived event', {
              flowId: params.flowId,
              txHash: log.transactionHash,
            })
            continue
          }

          // Verify recipient matches
          const recipientLower = params.metadata.recipient!.toLowerCase()
          const mintRecipientLower = parsed.mintRecipient.toLowerCase()

          if (mintRecipientLower !== recipientLower) {
            logger.debug('[EvmPoller] Recipient mismatch', {
              flowId: params.flowId,
              expectedRecipient: recipientLower,
              actualRecipient: mintRecipientLower,
            })
            continue
          }

          // Verify amount matches
          const expectedAmount = BigInt(params.metadata.amountBaseUnits!)
          if (parsed.amount !== expectedAmount) {
            logger.debug('[EvmPoller] Amount mismatch', {
              flowId: params.flowId,
              expectedAmount: expectedAmount.toString(),
              actualAmount: parsed.amount.toString(),
            })
            continue
          }

          // Verify source domain if provided
          if (
            params.metadata.sourceDomain !== undefined &&
            parsed.sourceDomain !== params.metadata.sourceDomain
          ) {
            logger.debug('[EvmPoller] Source domain mismatch', {
              flowId: params.flowId,
              expectedSourceDomain: params.metadata.sourceDomain,
              actualSourceDomain: parsed.sourceDomain,
            })
            continue
          }

          // Match found!
          const blockNumber = BigInt(log.blockNumber!)
          logger.info('[EvmPoller] EVM USDC mint detected via MessageReceived event', {
            flowId: params.flowId,
            txHash: log.transactionHash,
            blockNumber: blockNumber.toString(),
            nonce: parsed.nonce,
          })

          stages.push({
            stage: PAYMENT_STAGES.EVM_MINT_CONFIRMED,
            status: 'confirmed',
            source: 'poller',
            txHash: log.transactionHash,
            occurredAt: new Date().toISOString(),
          })

          cleanup()
          return {
            success: true,
            found: true,
            metadata: {
              ...params.metadata,
              txHash: log.transactionHash,
              blockNumber: Number(blockNumber),
            },
            stages,
            txHash: log.transactionHash,
            blockNumber: Number(blockNumber),
          }
        }

        chunkStart = chunkEnd + 1n
      }

      fromBlock = latest + 1n
      await sleep(intervalMs)
    }

    cleanup()

    if (wasTimeout()) {
      return createErrorResult('polling_timeout', 'EVM polling timed out')
    }

    return createErrorResult('polling_error', 'Polling aborted or timeout')
  } catch (error) {
    cleanup()

    if (isAborted(abortSignal)) {
      return createErrorResult('polling_error', 'Polling cancelled')
    }

    logger.error('[EvmPoller] EVM nonce-based poll error', {
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
 * Fallback polling approach using Transfer event scanning
 * Used when CCTP nonce is not available (backward compatibility)
 */
async function pollUsdcMintByTransfer(
  params: EvmPollParams,
  provider: ethers.JsonRpcProvider,
): Promise<ChainPollResult> {
  const timeoutMs = params.timeoutMs ?? 30 * 60 * 1000
  const intervalMs = params.intervalMs ?? 5000
  const { controller, cleanup, wasTimeout } = createPollTimeout(
    timeoutMs,
    params.flowId,
    params.abortSignal,
  )
  const abortSignal = params.abortSignal || controller.signal

  logger.info('[EvmPoller] Starting EVM mint polling with Transfer events', {
    flowId: params.flowId,
    usdcAddress: params.metadata.usdcAddress,
    recipient: params.metadata.recipient,
  })

  const stages: ChainStage[] = [
    {
      stage: PAYMENT_STAGES.EVM_MINT_POLLING,
      status: 'pending',
      source: 'poller',
      occurredAt: new Date().toISOString(),
    },
  ]

  try {
    const zeroAddress = '0x0000000000000000000000000000000000000000'
    const maxBlockRange =
      params.metadata.maxBlockRange && params.metadata.maxBlockRange > 0
        ? BigInt(params.metadata.maxBlockRange)
        : DEFAULT_EVM_MAX_BLOCK_RANGE

    let fromBlock = params.metadata.startBlock
      ? BigInt(params.metadata.startBlock)
      : undefined

    if (!fromBlock) {
      const latestBlock = await retryWithBackoff(
        () => provider.getBlockNumber(),
        3,
        500,
        5000,
        abortSignal,
      )
      fromBlock = latestBlock > 0 ? BigInt(latestBlock) - 1n : 0n
      logger.debug('[EvmPoller] Starting from latest block minus one', {
        flowId: params.flowId,
        fromBlock: fromBlock.toString(),
        latestBlock,
      })
    }

    while (!isAborted(abortSignal)) {
      const latestNumber = await retryWithBackoff(
        () => provider.getBlockNumber(),
        3,
        500,
        5000,
        abortSignal,
      )
      const latest = BigInt(latestNumber)

      if (latest < fromBlock!) {
        await sleep(intervalMs)
        continue
      }

      // Query for Transfer events from zero address to recipient in chunks
      let chunkStart = fromBlock!
      while (chunkStart <= latest) {
        if (isAborted(abortSignal)) break

        const chunkEndCandidate = chunkStart + maxBlockRange - 1n
        const chunkEnd = chunkEndCandidate < latest ? chunkEndCandidate : latest

        const filter: ethers.Filter = {
          fromBlock: toHexQuantity(chunkStart),
          toBlock: toHexQuantity(chunkEnd),
          address: params.metadata.usdcAddress,
          topics: [
            TRANSFER_TOPIC,
            toPaddedTopicAddress(zeroAddress),
            toPaddedTopicAddress(params.metadata.recipient!),
          ],
        }

        const logs = await retryWithBackoff(
          () => provider.getLogs(filter),
          3,
          500,
          5000,
          abortSignal,
        )

        for (const log of logs) {
          // data is uint256 value (32 bytes)
          const value = BigInt(log.data)
          if (value === BigInt(params.metadata.amountBaseUnits!)) {
            const blockNumber = BigInt(log.blockNumber!)
            logger.info('[EvmPoller] EVM USDC mint detected via Transfer event', {
              flowId: params.flowId,
              txHash: log.transactionHash,
              blockNumber: blockNumber.toString(),
            })

            stages.push({
              stage: PAYMENT_STAGES.EVM_MINT_CONFIRMED,
              status: 'confirmed',
              source: 'poller',
              txHash: log.transactionHash,
              occurredAt: new Date().toISOString(),
            })

            cleanup()
            return {
              success: true,
              found: true,
              metadata: {
                ...params.metadata,
                txHash: log.transactionHash,
                blockNumber: Number(blockNumber),
              },
              stages,
              txHash: log.transactionHash,
              blockNumber: Number(blockNumber),
            }
          }
        }

        chunkStart = chunkEnd + 1n
      }

      fromBlock = latest + 1n
      await sleep(intervalMs)
    }

    cleanup()

    if (wasTimeout()) {
      return createErrorResult('polling_timeout', 'EVM polling timed out')
    }

    return createErrorResult('polling_error', 'Polling aborted')
  } catch (error) {
    cleanup()

    if (isAborted(abortSignal)) {
      return createErrorResult('polling_error', 'Polling cancelled')
    }

    logger.error('[EvmPoller] EVM transfer-based poll error', {
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
 * EVM Chain Poller Implementation
 * Implements ChainPoller interface for modularity
 */
/**
 * Poll EVM deposit flow using Iris API
 * Extracts MessageSent event and polls Iris API for attestation
 */
async function pollDepositWithIris(
  params: EvmPollParams,
  provider: ethers.JsonRpcProvider,
): Promise<ChainPollResult> {
  const timeoutMs = params.timeoutMs ?? 30 * 60 * 1000
  const pollIntervalMs = params.intervalMs ?? 3000
  const requestTimeoutMs = 5000
  const { controller, cleanup, wasTimeout } = createPollTimeout(
    timeoutMs,
    params.flowId,
    params.abortSignal,
  )
  const abortSignal = params.abortSignal || controller.signal

  logger.info('[EvmPoller] Starting EVM deposit polling with Iris API', {
    flowId: params.flowId,
    timeoutMs,
    pollIntervalMs,
    requestTimeoutMs,
    hasAbortSignal: Boolean(params.abortSignal),
  })

  const chainKey = params.metadata.chainKey || params.chain
  if (!chainKey) {
    logger.error('[EvmPoller] Missing chain key in pollDepositWithIris', {
      flowId: params.flowId,
      chain: params.chain,
      chainKey: params.metadata.chainKey,
      metadataKeys: Object.keys(params.metadata),
    })
    cleanup()
    return createErrorResult('polling_error', 'Missing chain key')
  }

  const txHash = params.metadata.txHash
  if (!txHash) {
    logger.error('[EvmPoller] Missing transaction hash for deposit flow', {
      flowId: params.flowId,
      chainKey,
      metadataKeys: Object.keys(params.metadata),
      metadata: {
        ...params.metadata,
        // Don't log full metadata, just structure
        txHash: params.metadata.txHash ? 'present' : 'missing',
      },
    })
    cleanup()
    return createErrorResult('polling_error', 'Missing transaction hash for deposit flow')
  }

  logger.info('[EvmPoller] Deposit flow parameters validated', {
    flowId: params.flowId,
    txHash,
    chainKey,
  })

  const stages: ChainStage[] = [
    {
      stage: DEPOSIT_STAGES.EVM_BURN_CONFIRMED,
      status: 'pending',
      source: 'poller',
      occurredAt: new Date().toISOString(),
    },
  ]

  try {
    // Step 1: Extract MessageSent event from transaction receipt
    logger.debug('[EvmPoller] Extracting MessageSent event from transaction receipt', {
      flowId: params.flowId,
      txHash,
      chainKey,
    })

    const extractionResult: MessageSentExtractionResult = await extractMessageSent(
      txHash,
      chainKey,
      provider,
    )

    logger.debug('[EvmPoller] MessageSent extraction result', {
      flowId: params.flowId,
      success: extractionResult.success,
      hasData: Boolean(extractionResult.data),
      error: extractionResult.error,
    })

    if (!extractionResult.success || !extractionResult.data) {
      logger.error('[EvmPoller] Failed to extract MessageSent event', {
        flowId: params.flowId,
        txHash,
        chainKey,
        error: extractionResult.error,
        extractionResult: {
          success: extractionResult.success,
          hasData: Boolean(extractionResult.data),
        },
      })
      cleanup()
      return createErrorResult(
        'polling_error',
        `Failed to extract MessageSent event: ${extractionResult.error}`,
      )
    }

    const { irisLookupID, nonce, sourceDomain, destinationDomain } = extractionResult.data

    // Mark EVM_BURN_CONFIRMED as confirmed (we have the receipt)
    stages[0].status = 'confirmed'
    stages[0].txHash = txHash
    stages[0].occurredAt = new Date().toISOString()

    // Add Iris attestation polling stage
    stages.push({
      stage: DEPOSIT_STAGES.IRIS_ATTESTATION_POLLING,
      status: 'pending',
      source: 'poller',
      occurredAt: new Date().toISOString(),
    })

    logger.info('[EvmPoller] MessageSent event extracted, starting Iris attestation polling', {
      flowId: params.flowId,
      irisLookupID,
      nonce,
      sourceDomain,
      destinationDomain,
    })

    // Step 2: Poll Iris API for attestation
    // Use remaining timeout (subtract time already spent on extraction)
    const extractionStartTime = Date.now()
    const remainingTimeoutMs = Math.max(
      timeoutMs - (Date.now() - extractionStartTime),
      60000, // Minimum 1 minute for Iris polling
    )

    const irisResult: IrisPollingResult = await pollIrisAttestation(
      {
        txHash,
        chainId: chainKey,
        flowId: params.flowId,
        timeoutMs: remainingTimeoutMs,
        pollIntervalMs,
        requestTimeoutMs,
        abortSignal,
      },
      irisLookupID,
    )

    if (wasTimeout()) {
      cleanup()
      return createErrorResult('polling_timeout', 'Iris attestation polling timed out')
    }

    if (isAborted(abortSignal)) {
      cleanup()
      return createErrorResult('polling_error', 'Polling aborted')
    }

    if (!irisResult.success || !irisResult.attestation) {
      cleanup()
      return createErrorResult(
        'polling_error',
        `Iris attestation polling failed: ${irisResult.error}`,
      )
    }

    // Mark Iris attestation as complete
    stages[1].status = 'confirmed'
    stages[1].occurredAt = new Date().toISOString()

    stages.push({
      stage: DEPOSIT_STAGES.IRIS_ATTESTATION_COMPLETE,
      status: 'confirmed',
      source: 'poller',
      occurredAt: new Date().toISOString(),
    })

    logger.info('[EvmPoller] Iris attestation complete', {
      flowId: params.flowId,
      irisLookupID,
      attestation: irisResult.attestation.substring(0, 20) + '...',
    })

    cleanup()
    return {
      success: true,
      found: true,
      metadata: {
        ...params.metadata,
        irisLookupID,
        cctpNonce: nonce,
        sourceDomain,
        destinationDomain,
        attestation: irisResult.attestation,
      },
      stages,
    }
  } catch (error) {
    cleanup()

    if (isAborted(abortSignal)) {
      return createErrorResult('polling_error', 'Polling cancelled')
    }

    logger.error('[EvmPoller] EVM deposit poll with Iris error', {
      flowId: params.flowId,
      error: error instanceof Error ? error.message : String(error),
      txHash,
    })

    return createErrorResult(
      'polling_error',
      error instanceof Error ? error.message : 'Unknown error',
    )
  }
}

export class EvmPoller implements ChainPoller {
  /**
   * Poll EVM chain for deposit or payment flows
   * 
   * - Deposit flow: Extracts MessageSent event and polls Iris API for attestation
   * - Payment flow: Polls for USDC mint events (MessageReceived or Transfer)
   * 
   * @param params - Polling parameters
   * @returns Polling result with success status, metadata, and stages
   */
  async poll(params: ChainPollParams): Promise<ChainPollResult> {
    const evmParams = params as EvmPollParams

    // Log initialization with all parameters
    logger.info('[EvmPoller] Starting EVM polling', {
      flowId: params.flowId,
      chain: params.chain,
      chainKey: evmParams.metadata.chainKey,
      flowType: evmParams.metadata.flowType,
      txHash: evmParams.metadata.txHash,
      timeoutMs: params.timeoutMs,
      intervalMs: params.intervalMs,
      metadata: {
        ...evmParams.metadata,
        // Don't log sensitive data, but log structure
        amountBaseUnits: evmParams.metadata.amountBaseUnits ? 'present' : 'missing',
        recipient: evmParams.metadata.recipient ? 'present' : 'missing',
        usdcAddress: evmParams.metadata.usdcAddress ? 'present' : 'missing',
        cctpNonce: evmParams.metadata.cctpNonce,
        messageTransmitterAddress: evmParams.metadata.messageTransmitterAddress ? 'present' : 'missing',
        startBlock: evmParams.metadata.startBlock,
      },
    })

    // Get EVM provider for the chain
    // Use chainKey from metadata (actual chain key like 'sepolia'), fallback to chain param
    const chainKey = evmParams.metadata.chainKey || params.chain
    if (!chainKey) {
      logger.error('[EvmPoller] Missing chain key', {
        flowId: params.flowId,
        chain: params.chain,
        chainKey: evmParams.metadata.chainKey,
        metadataKeys: Object.keys(evmParams.metadata),
      })
      return createErrorResult(
        'polling_error',
        'Missing chain key (chainKey in metadata or chain param)',
      )
    }

    logger.debug('[EvmPoller] Resolved chain key', {
      flowId: params.flowId,
      chainKey,
      source: evmParams.metadata.chainKey ? 'metadata' : 'chain param',
    })

    let provider: ethers.JsonRpcProvider
    try {
      logger.debug('[EvmPoller] Getting EVM provider', {
        flowId: params.flowId,
        chainKey,
      })
      provider = await getEvmProvider(chainKey)
      logger.debug('[EvmPoller] EVM provider obtained successfully', {
        flowId: params.flowId,
        chainKey,
        network: provider.network ? {
          chainId: provider.network.chainId,
          name: provider.network.name,
        } : 'unknown',
      })
    } catch (error) {
      logger.error('[EvmPoller] Failed to get EVM provider', {
        flowId: params.flowId,
        chainKey,
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
      })
      return createErrorResult(
        'polling_error',
        `Failed to get EVM provider for chain: ${chainKey}`,
      )
    }

    // Determine flow type from metadata
    const flowType = evmParams.metadata.flowType as 'deposit' | 'payment' | undefined

    logger.debug('[EvmPoller] Determining flow type', {
      flowId: params.flowId,
      flowType,
      hasTxHash: Boolean(evmParams.metadata.txHash),
    })

    // Deposit flow: Use Iris API
    if (flowType === 'deposit') {
      logger.info('[EvmPoller] Using deposit flow (Iris API)', {
        flowId: params.flowId,
        chainKey,
        txHash: evmParams.metadata.txHash,
      })

      // Validate deposit-specific prerequisites
      if (!evmParams.metadata.txHash) {
        logger.error('[EvmPoller] Missing txHash for deposit flow', {
          flowId: params.flowId,
          chainKey,
          metadataKeys: Object.keys(evmParams.metadata),
        })
        return createErrorResult(
          'polling_error',
          'Missing required parameter: txHash (required for deposit flow)',
        )
      }

      return pollDepositWithIris(evmParams, provider)
    }

    // Payment flow: Poll for mint events
    logger.info('[EvmPoller] Using payment flow (mint event polling)', {
      flowId: params.flowId,
      chainKey,
    })

    // Validate payment-specific params
    const missingParams: string[] = []
    if (!evmParams.metadata.usdcAddress) {
      missingParams.push('usdcAddress')
    }
    if (!evmParams.metadata.recipient) {
      missingParams.push('recipient')
    }

    if (missingParams.length > 0) {
      logger.error('[EvmPoller] Missing required payment flow parameters', {
        flowId: params.flowId,
        chainKey,
        missingParams,
        metadataKeys: Object.keys(evmParams.metadata),
      })
      return createErrorResult(
        'polling_error',
        `Missing required EVM polling parameters: ${missingParams.join(', ')}`,
      )
    }

    // Check if nonce-based polling is available
    const hasNonce = evmParams.metadata.cctpNonce !== undefined
    const hasMessageTransmitter = Boolean(evmParams.metadata.messageTransmitterAddress)
    const useNonceBased = hasNonce && hasMessageTransmitter

    logger.debug('[EvmPoller] Determining polling method', {
      flowId: params.flowId,
      hasNonce,
      hasMessageTransmitter,
      useNonceBased,
    })

    if (useNonceBased) {
      logger.info('[EvmPoller] Using nonce-based EVM mint polling', {
        flowId: params.flowId,
        cctpNonce: evmParams.metadata.cctpNonce,
        messageTransmitterAddress: evmParams.metadata.messageTransmitterAddress,
      })
      return pollUsdcMintByNonce(evmParams, provider)
    } else {
      logger.info('[EvmPoller] Using transfer-based EVM mint polling (fallback)', {
        flowId: params.flowId,
        reason: !hasNonce ? 'no nonce' : 'no message transmitter',
      })
      return pollUsdcMintByTransfer(evmParams, provider)
    }
  }
}

/**
 * Create EVM poller instance
 */
export function createEvmPoller(): ChainPoller {
  return new EvmPoller()
}

