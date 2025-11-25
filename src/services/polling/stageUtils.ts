/**
 * Stage Utilities
 * 
 * Helper functions for reading stages from unified structure (pollingState)
 * and legacy structures (clientStages, flowStatusSnapshot).
 */

import type { StoredTransaction } from '@/services/tx/transactionStorageService'
import type { ChainStage } from '@/types/flow'
import type { ChainKey } from '@/shared/flowStages'
import { getChainOrder } from '@/shared/flowStages'
import { migrateClientStagesToUnified } from './pollingStateManager'

/**
 * Get all stages from a transaction (unified format)
 * Reads from pollingState.chainStatus[chain].stages if available,
 * otherwise falls back to clientStages + flowStatusSnapshot
 * 
 * @param tx - Transaction to get stages from
 * @param flowType - Flow type ('deposit' or 'payment')
 * @returns Array of stages in chronological order
 */
export function getAllStagesFromTransaction(
  tx: StoredTransaction,
  flowType: 'deposit' | 'payment',
): ChainStage[] {
  const stages: ChainStage[] = []

  // Migrate clientStages to unified structure if needed
  if (tx.clientStages && tx.clientStages.length > 0 && tx.pollingState) {
    migrateClientStagesToUnified(tx.id)
    // Reload transaction after migration
    const updatedTx = tx // Will be reloaded by caller if needed
    if (updatedTx.pollingState) {
      tx = updatedTx
    }
  }

  // Read from unified pollingState structure if available
  if (tx.pollingState) {
    const chainOrder = getChainOrder(flowType)
    for (const chain of chainOrder) {
      const chainStatus = tx.pollingState.chainStatus[chain]
      if (chainStatus?.stages && chainStatus.stages.length > 0) {
        stages.push(...chainStatus.stages)
      }
    }
  }

  // Fallback: read from clientStages (legacy)
  if (stages.length === 0 && tx.clientStages && tx.clientStages.length > 0) {
    stages.push(...tx.clientStages)
  }

  // Also read from flowStatusSnapshot (backend-managed flows)
  if (tx.flowStatusSnapshot) {
    const chainOrder = getChainOrder(flowType)
    for (const chain of chainOrder) {
      const progress = tx.flowStatusSnapshot.chainProgress[chain]
      if (!progress) continue

      // Add regular stages
      if (progress.stages && progress.stages.length > 0) {
        stages.push(...progress.stages)
      }

      // Add gasless stages
      if (progress.gaslessStages && progress.gaslessStages.length > 0) {
        stages.push(...progress.gaslessStages)
      }
    }
  }

  // Sort by occurredAt timestamp (chronological order)
  stages.sort((a, b) => {
    if (!a.occurredAt || !b.occurredAt) return 0
    return new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
  })

  return stages
}

/**
 * Get stages for a specific chain from a transaction
 * 
 * @param tx - Transaction to get stages from
 * @param chain - Chain key
 * @returns Array of stages for the chain
 */
export function getStagesForChain(
  tx: StoredTransaction,
  chain: ChainKey,
): ChainStage[] {
  const stages: ChainStage[] = []

  // Read from unified pollingState structure if available
  if (tx.pollingState) {
    const chainStatus = tx.pollingState.chainStatus[chain]
    if (chainStatus?.stages && chainStatus.stages.length > 0) {
      stages.push(...chainStatus.stages)
    }
  }

  // Fallback: read from clientStages (legacy) - filter by chain
  if (tx.clientStages && tx.clientStages.length > 0) {
    const chainStages = tx.clientStages.filter(
      (s) => (s.metadata?.chain as ChainKey) === chain,
    )
    stages.push(...chainStages)
  }

  // Also read from flowStatusSnapshot (backend-managed flows)
  if (tx.flowStatusSnapshot) {
    const progress = tx.flowStatusSnapshot.chainProgress[chain]
    if (progress) {
      if (progress.stages && progress.stages.length > 0) {
        stages.push(...progress.stages)
      }
      if (progress.gaslessStages && progress.gaslessStages.length > 0) {
        stages.push(...progress.gaslessStages)
      }
    }
  }

  // Sort by occurredAt timestamp
  stages.sort((a, b) => {
    if (!a.occurredAt || !b.occurredAt) return 0
    return new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
  })

  return stages
}

