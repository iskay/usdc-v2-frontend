import type { TxStatusMessage } from '@/types/tx'
import type { FlowStatus } from '@/types/flow'
import { flowStorageService } from '@/services/flow/flowStorageService'
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
    // Try to find flow by localId first
    let flowInitiation = flowStorageService.getFlowInitiation(txId)
    let flowId: string | undefined

    if (flowInitiation?.flowId) {
      flowId = flowInitiation.flowId
    } else {
      // If not found by localId, try treating txId as flowId
      flowInitiation = flowStorageService.getFlowInitiationByFlowId(txId)
      if (flowInitiation) {
        flowId = flowInitiation.flowId
      } else {
        // Try using txId directly as flowId
        flowId = txId
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

  // Try to find flowId
  let flowInitiation = flowStorageService.getFlowInitiation(txId)
  let flowId: string | undefined

  if (flowInitiation?.flowId) {
    flowId = flowInitiation.flowId
  } else {
    // Try treating txId as flowId
    flowInitiation = flowStorageService.getFlowInitiationByFlowId(txId)
    if (flowInitiation) {
      flowId = flowInitiation.flowId
    } else {
      flowId = txId
    }
  }

  if (!flowId) {
    logger.warn('[TxTracker] No flowId found, cannot start polling', { txId })
    // Return a no-op cleanup function
    return () => {}
  }

  // Set up callback that maps flow status to TxStatusMessage
  const statusUpdateCallback = (polledFlowId: string, flowStatus: FlowStatus) => {
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
