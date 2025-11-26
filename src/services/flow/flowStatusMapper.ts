import type {
  FlowStatus,
  FlowInitiationMetadata,
  UIStage,
  ChainStage,
} from '@/types/flow'
import type { StoredTransaction } from '@/services/tx/transactionStorageService'
import { getChainOrder } from '@/shared/flowStages'
import { getAllStagesFromTransaction } from '@/services/polling/stageUtils'

// Re-export UIStage for convenience
export type { UIStage } from '@/types/flow'

/**
 * Map backend flow status to UI-friendly stages.
 * Combines backend chain progress with client-side stages for complete UI state.
 * Now supports unified stage storage (pollingState) in addition to legacy formats.
 * 
 * @param flowStatus - Backend flow status (optional, for backend-managed flows)
 * @param _flowInitiation - Flow initiation metadata (unused)
 * @param flowType - Flow type ('deposit' or 'payment')
 * @param clientStages - Optional client-side stages (legacy parameter, kept for backward compatibility)
 * @param tx - Optional transaction object (for reading unified stages from pollingState)
 */
export function mapFlowStatusToUIStages(
  flowStatus?: FlowStatus,
  _flowInitiation: FlowInitiationMetadata | null = null,
  flowType: 'deposit' | 'payment' = 'deposit',
  clientStages?: ChainStage[],
  tx?: StoredTransaction,
): UIStage[] {
  const stages: UIStage[] = []
  
  // If transaction is provided, use unified stage reading
  if (tx) {
    const allStages = getAllStagesFromTransaction(tx, flowType)

    // Convert to UIStage format
    for (const stage of allStages) {
      // Extract chain from metadata or determine from stage
      let chain: 'evm' | 'noble' | 'namada' = 'evm'
      if (stage.metadata?.chain) {
        chain = stage.metadata.chain as 'evm' | 'noble' | 'namada'
      } else {
        // Try to determine chain from flowStatusSnapshot if available
        const chainOrder = getChainOrder(flowType)
        for (const c of chainOrder) {
          if (tx.flowStatusSnapshot?.chainProgress[c]?.stages?.some((s) => s.stage === stage.stage)) {
            chain = c
            break
          }
        }
      }

      stages.push({
        chain,
        stage: stage.stage,
        status: stage.status || 'pending',
        txHash: stage.txHash,
        occurredAt: stage.occurredAt,
        message: stage.message,
      })
    }

    // Sort all stages by occurredAt timestamp (chronological order)
    stages.sort((a, b) => {
      if (!a.occurredAt || !b.occurredAt) return 0
      return new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
    })

    return stages
  }

  // Legacy path: use flowStatus and clientStages
  // First, add client-side stages if present
  if (clientStages && clientStages.length > 0) {
    for (const stage of clientStages) {
      // Extract chain from metadata (stored there for client stages)
      const chain = (stage.metadata?.chain as 'evm' | 'noble' | 'namada') || 'evm'
      stages.push({
        chain,
        stage: stage.stage,
        status: stage.status || 'pending',
        txHash: stage.txHash,
        occurredAt: stage.occurredAt,
        message: stage.message,
      })
    }
  }
  
  // Then, add backend stages from flowStatusSnapshot
  if (flowStatus) {
  // Determine chain order based on flow type
  const chainOrder = getChainOrder(flowType)

  // Process each chain in order
  for (const chain of chainOrder) {
    const progress = flowStatus.chainProgress[chain]
    if (!progress) continue

    // Add regular stages
    if (progress.stages && progress.stages.length > 0) {
      for (const stage of progress.stages) {
        stages.push({
          chain,
          stage: stage.stage,
          status: stage.status || 'pending',
          txHash: stage.txHash,
          occurredAt: stage.occurredAt,
          message: stage.message,
        })
      }
    }

    // Add gasless stages (if any)
    if (progress.gaslessStages && progress.gaslessStages.length > 0) {
      for (const stage of progress.gaslessStages) {
        stages.push({
          chain,
          stage: stage.stage,
          status: stage.status || 'pending',
          txHash: stage.txHash,
          occurredAt: stage.occurredAt,
          message: stage.message,
        })
        }
      }
    }
  }

  // Sort all stages by occurredAt timestamp (chronological order)
  stages.sort((a, b) => {
    if (!a.occurredAt || !b.occurredAt) return 0
    return new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
  })

  return stages
}

/**
 * Get overall flow status from backend flow status.
 * 
 * @param flowStatus - Backend flow status
 * @returns Overall status: 'pending', 'completed', or 'failed'
 */
export function getOverallFlowStatus(flowStatus: FlowStatus): 'pending' | 'completed' | 'failed' {
  // Map 'undetermined' to 'pending' as it's an intermediate state
  if (flowStatus.status === 'undetermined') {
    return 'pending'
  }
  return flowStatus.status
}

/**
 * Get current active stage from flow status or transaction.
 * Returns the most recent stage that is not completed.
 * 
 * @param flowStatus - Backend flow status (optional, for backend-managed flows)
 * @param flowType - Flow type ('deposit' or 'payment')
 * @param clientStages - Optional client-side stages (legacy parameter)
 * @param tx - Optional transaction object (for reading unified stages from pollingState)
 * @returns Current active stage or null if all stages are complete
 */
export function getCurrentActiveStage(
  flowStatus?: FlowStatus,
  flowType: 'deposit' | 'payment' = 'deposit',
  clientStages?: ChainStage[],
  tx?: StoredTransaction,
): UIStage | null {
  const stages = mapFlowStatusToUIStages(flowStatus, null, flowType, clientStages, tx)
  
  // Find the first stage that is not confirmed
  for (const stage of stages) {
    if (stage.status !== 'confirmed' && stage.status !== 'failed') {
      return stage
    }
  }

  // If all stages are confirmed, return the last one
  if (stages.length > 0) {
    return stages[stages.length - 1]
  }

  return null
}

/**
 * Get progress percentage for a flow.
 * 
 * @param flowStatus - Backend flow status (optional, for backend-managed flows)
 * @param flowType - Flow type ('deposit' or 'payment')
 * @param clientStages - Optional client-side stages (legacy parameter)
 * @param tx - Optional transaction object (for reading unified stages from pollingState)
 * @returns Progress percentage (0-100)
 */
export function getFlowProgress(
  flowStatus?: FlowStatus,
  flowType: 'deposit' | 'payment' = 'deposit',
  clientStages?: ChainStage[],
  tx?: StoredTransaction,
): number {
  // If transaction is provided, check pollingState status
  if (tx?.pollingState) {
    if (tx.pollingState.flowStatus === 'success') {
      return 100
    }
    if (tx.pollingState.flowStatus === 'tx_error' || tx.pollingState.flowStatus === 'polling_error') {
      return 0
    }
  }

  // Check flowStatus if provided
  if (flowStatus) {
  if (flowStatus.status === 'completed') {
    return 100
  }
  if (flowStatus.status === 'failed') {
    return 0
    }
  }

  const stages = mapFlowStatusToUIStages(flowStatus, null, flowType, clientStages, tx)
  if (stages.length === 0) {
    return 0
  }

  const confirmedStages = stages.filter((s) => s.status === 'confirmed').length
  return Math.round((confirmedStages / stages.length) * 100)
}

/**
 * Get estimated time remaining for a flow.
 * This is a simple estimate based on flow type and current stage.
 * 
 * @param flowStatus - Backend flow status
 * @param flowType - Flow type ('deposit' or 'payment')
 * @returns Estimated time remaining in minutes (string)
 */
export function getEstimatedTimeRemaining(
  flowStatus?: FlowStatus,
  flowType: 'deposit' | 'payment' = 'deposit',
  tx?: StoredTransaction,
): string {
  // Check if flow is completed
  if (tx?.pollingState) {
    if (tx.pollingState.flowStatus === 'success' || 
        tx.pollingState.flowStatus === 'tx_error' || 
        tx.pollingState.flowStatus === 'polling_error') {
      return '0'
    }
  }
  
  if (flowStatus) {
  if (flowStatus.status === 'completed' || flowStatus.status === 'failed') {
    return '0'
    }
  }

  const currentStage = getCurrentActiveStage(flowStatus, flowType, undefined, tx)
  if (!currentStage) {
    return '5' // Default estimate
  }

  // Simple estimates based on chain and stage
  const estimates: Record<string, string> = {
    evm: '2-3',
    noble: '1-2',
    namada: '1-2',
  }

  return estimates[currentStage.chain] || '3'
}

