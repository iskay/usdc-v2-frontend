import type { TxStatusMessage } from '@/types/tx'
import type { FlowStatus } from '@/types/flow'
import { transactionStorageService } from '@/services/tx/transactionStorageService'
import { flowStatusPoller } from '@/services/flow/flowStatusPoller'
import { flowStatusCacheService } from '@/services/flow/flowStatusCacheService'
import { getFlowStatus } from '@/services/api/backendClient'
import { logger } from '@/utils/logger'

/**
 * Map backend flow status to TxStatusMessage format.
 * This maintains backward compatibility with existing code.
 */
function mapFlowStatusToTxStatusMessage(
  txId: string,
  flowStatus: FlowStatus,
): TxStatusMessage {
  // Determine stage based on flow status and chain progress
  let stage: TxStatusMessage['stage'] = 'submitting'
  let summary = 'Transaction in progress'

  if (flowStatus.status === 'completed') {
    stage = 'finalized'
    summary = 'Transaction completed successfully'
  } else if (flowStatus.status === 'failed') {
    stage = 'error'
    summary = 'Transaction failed'
  } else {
    // Check chain progress to determine current stage
    const { chainProgress } = flowStatus
    
    // For deposits: EVM → Noble → Namada
    // For payments: Namada → Noble → EVM
    if (chainProgress.evm?.stages && chainProgress.evm.stages.length > 0) {
      const lastStage = chainProgress.evm.stages[chainProgress.evm.stages.length - 1]
      if (lastStage.status === 'confirmed') {
        stage = 'broadcasted'
        summary = 'EVM transaction confirmed'
      }
    } else if (chainProgress.namada?.stages && chainProgress.namada.stages.length > 0) {
      const lastStage = chainProgress.namada.stages[chainProgress.namada.stages.length - 1]
      if (lastStage.status === 'confirmed') {
        stage = 'broadcasted'
        summary = 'Namada transaction confirmed'
      }
    }
  }

  return {
    txId,
    stage,
    summary,
    occurredAt: flowStatus.lastUpdated,
  }
}

/**
 * Poll transaction status using flow-based tracking.
 * 
 * @param txId - Transaction ID (can be localId or flowId)
 * @returns Status message if found, undefined otherwise
 */
export async function pollTxStatus(txId: string): Promise<TxStatusMessage | undefined> {
  try {
    // Try to find transaction by ID first
    let tx = transactionStorageService.getTransaction(txId)
    let flowId: string | undefined

    if (tx?.flowId) {
      // Transaction has flowId - use it
      flowId = tx.flowId
    } else if (tx?.flowMetadata?.localId === txId) {
      // txId is a localId, but flowId not set yet (not registered with backend)
      logger.debug('[TxTracker] Transaction found but flowId not yet registered', { txId })
      return undefined
    } else {
      // Try treating txId as flowId (look up transaction by flowId)
      tx = transactionStorageService.getTransactionByFlowId(txId)
      if (tx?.flowId) {
        flowId = tx.flowId
      } else {
        // Try treating txId as localId
        tx = transactionStorageService.getTransactionByLocalId(txId)
        if (tx?.flowId) {
          flowId = tx.flowId
        } else {
          // Last resort: assume txId is flowId
          flowId = txId
        }
      }
    }

    if (!flowId) {
      logger.debug('[TxTracker] No flowId found for txId', { txId })
      return undefined
    }

    // Try to get cached status first
    let flowStatus = flowStatusCacheService.getCachedFlowStatus(flowId)
    
    // If not cached or cache is stale (older than 30 seconds), fetch from backend
    if (!flowStatus || Date.now() - flowStatus.lastUpdated > 30000) {
      try {
        flowStatus = await getFlowStatus(flowId)
        flowStatusCacheService.cacheFlowStatus(flowId, flowStatus)
      } catch (error) {
        // If fetch fails, use cached status if available
        if (flowStatus) {
          logger.warn('[TxTracker] Failed to fetch flow status, using cache', {
            flowId,
            error: error instanceof Error ? error.message : String(error),
          })
        } else {
          logger.warn('[TxTracker] Failed to fetch flow status and no cache available', {
            flowId,
            error: error instanceof Error ? error.message : String(error),
          })
          return undefined
        }
      }
    }

    return mapFlowStatusToTxStatusMessage(txId, flowStatus)
  } catch (error) {
    logger.warn('[TxTracker] Error polling transaction status', {
      txId,
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}

/**
 * Schedule transaction tracking with flow-based polling.
 * 
 * @param txId - Transaction ID (can be localId or flowId)
 * @param onUpdate - Callback for status updates
 * @returns Cleanup function to stop tracking
 */
export function scheduleTxTracking(txId: string, onUpdate: (message: TxStatusMessage) => void): () => void {
  logger.debug('[TxTracker] Scheduling transaction tracking', { txId })

  // Try to find transaction and get flowId
  let tx = transactionStorageService.getTransaction(txId)
  let flowId: string | undefined

  if (tx?.flowId) {
    // Transaction has flowId - use it
    flowId = tx.flowId
  } else {
    // Try treating txId as flowId (look up transaction by flowId)
    tx = transactionStorageService.getTransactionByFlowId(txId)
    if (tx?.flowId) {
      flowId = tx.flowId
    } else {
      // Try treating txId as localId
      tx = transactionStorageService.getTransactionByLocalId(txId)
      if (tx?.flowId) {
        flowId = tx.flowId
      } else {
        // Last resort: assume txId is flowId
        flowId = txId
      }
    }
  }

  if (!flowId) {
    logger.warn('[TxTracker] No flowId found, cannot start polling', { txId })
    // Return a no-op cleanup function
    return () => {}
  }

  // Set up callback that maps flow status to TxStatusMessage
  const statusUpdateCallback = (_polledFlowId: string, flowStatus: FlowStatus) => {
    const message = mapFlowStatusToTxStatusMessage(txId, flowStatus)
    onUpdate(message)
  }

  // Start polling
  flowStatusPoller.startPolling(flowId, statusUpdateCallback)

  // Return cleanup function
  return () => {
    flowStatusPoller.stopPolling(flowId!)
    logger.debug('[TxTracker] Stopped transaction tracking', { txId, flowId })
  }
}
