/**
 * Polling State Manager
 * 
 * Manages persistence and updates of polling state for transactions.
 * Provides utilities for finding latest completed stages and managing resume checkpoints.
 */

import type { PollingState, ChainStatus, ChainPollMetadata } from './types'
import type { StoredTransaction } from '@/services/tx/transactionStorageService'
import type { ChainStage } from '@/types/flow'
import type { ChainKey, FlowStage } from '@/shared/flowStages'
import { transactionStorageService } from '@/services/tx/transactionStorageService'
import { getChainOrder, getExpectedStages, getNextStage } from '@/shared/flowStages'
import { logger } from '@/utils/logger'

/**
 * Update polling state for a transaction
 * 
 * @param txId - Transaction ID
 * @param updates - Partial polling state updates
 */
export function updatePollingState(
  txId: string,
  updates: Partial<PollingState>,
): void {
  try {
    const tx = transactionStorageService.getTransaction(txId)
    if (!tx) {
      logger.warn('[PollingStateManager] Transaction not found for polling state update', {
        txId,
      })
      return
    }

    // CRITICAL: Read current state directly from transaction to avoid circular dependency
    // Then check if migration is needed (metadata missing but exists in chainParams)
    let currentState = tx.pollingState
    
    // If metadata is missing, check if it needs migration from chainParams
    if (currentState && !currentState.metadata) {
      const initialChain = tx.direction === 'deposit' ? 'evm' : 'namada'
      const initialChainMetadata = (currentState.chainParams as any)?.[initialChain]?.metadata
      
      if (initialChainMetadata && Object.keys(initialChainMetadata).length > 0) {
        // Metadata exists in old structure - migrate it
        const allMetadata: ChainPollMetadata = { ...initialChainMetadata }
        
        // Merge metadata from other chains
        for (const chainKey in currentState.chainParams) {
          const chain = chainKey as ChainKey
          const chainParams = (currentState.chainParams as any)[chain]
          if (chainParams?.metadata && chain !== initialChain) {
            Object.assign(allMetadata, chainParams.metadata)
          }
        }
        
        // Add metadata to currentState (don't save yet - will be saved below)
        currentState = {
          ...currentState,
          metadata: allMetadata,
        }
      }
    }
    
    // CRITICAL: Preserve metadata BEFORE spreading updates
    // This ensures metadata is never lost when updating other fields
    const preservedMetadata = updates.metadata !== undefined
      ? {
          ...(currentState?.metadata || {}),
          ...updates.metadata,
        }
      : currentState?.metadata
    
    const updatedState: PollingState = {
      ...currentState,
      ...updates,
      lastUpdatedAt: Date.now(),
      // Preserve required fields if creating new state
      flowStatus: updates.flowStatus ?? currentState?.flowStatus ?? 'pending',
      flowType: updates.flowType ?? currentState?.flowType ?? (tx.direction === 'deposit' ? 'deposit' : 'payment'),
      startedAt: updates.startedAt ?? currentState?.startedAt ?? Date.now(),
      chainStatus: {
        ...currentState?.chainStatus,
        ...updates.chainStatus,
      },
      // CRITICAL: Explicitly set metadata to ensure it's preserved
      // This overrides any metadata: undefined that might be in updates
      metadata: preservedMetadata,
      // Merge chainParams (for poller config only - no metadata field)
      // If updates.chainParams is provided, merge it with current chainParams
      // If updates.chainParams is undefined, preserve current chainParams
      chainParams: updates.chainParams !== undefined
        ? (() => {
            // Start with all current chainParams to preserve chains not being updated
            const merged: PollingState['chainParams'] = {
              ...(currentState?.chainParams || {}),
            }
            
            // CRITICAL: If updates.chainParams is empty object {}, don't overwrite existing chainParams
            // This prevents accidental clearing of chainParams when empty object is passed
            const updateKeys = Object.keys(updates.chainParams)
            if (updateKeys.length === 0 && Object.keys(merged).length > 0) {
              // Empty update but we have existing chainParams - preserve them
              return merged
            }
            
            // Process each chain in updates.chainParams and merge (no metadata field)
            for (const chainKey in updates.chainParams) {
              const chain = chainKey as keyof typeof updates.chainParams
              const currentChainParams = currentState?.chainParams?.[chain]
              const updatedChainParams = updates.chainParams[chain]
              
              if (updatedChainParams) {
                // Merge chainParams (no metadata field - metadata is in pollingState.metadata)
                merged[chain] = {
                  ...currentChainParams,
                  ...updatedChainParams,
                } as any
              }
            }
            
            return merged
          })()
        : (currentState?.chainParams || {}),
    }

    transactionStorageService.updateTransaction(txId, {
      pollingState: updatedState,
    })

    logger.debug('[PollingStateManager] Updated polling state', {
      txId,
      updates: Object.keys(updates),
    })
  } catch (error) {
    logger.error('[PollingStateManager] Failed to update polling state', {
      txId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Update chain status for a specific chain
 * 
 * @param txId - Transaction ID
 * @param chain - Chain key
 * @param status - Chain status updates
 */
export function updateChainStatus(
  txId: string,
  chain: ChainKey,
  status: Partial<ChainStatus>,
): void {
  try {
    const tx = transactionStorageService.getTransaction(txId)
    if (!tx || !tx.pollingState) {
      logger.warn('[PollingStateManager] Transaction or polling state not found', {
        txId,
        chain,
      })
      return
    }

    const currentChainStatus = tx.pollingState.chainStatus[chain] ?? {
      status: 'pending',
      completedStages: [],
    }

    const updatedChainStatus: ChainStatus = {
      ...currentChainStatus,
      ...status,
      // Preserve completed stages array
      completedStages: status.completedStages ?? currentChainStatus.completedStages,
      // Preserve stages array
      stages: status.stages ?? currentChainStatus.stages,
      // Preserve retry count if not explicitly updated
      retryCount: status.retryCount ?? currentChainStatus.retryCount,
      // Preserve error code if not explicitly updated
      errorCode: status.errorCode ?? currentChainStatus.errorCode,
    }

    updatePollingState(txId, {
      chainStatus: {
        ...tx.pollingState.chainStatus,
        [chain]: updatedChainStatus,
      },
    })

    logger.debug('[PollingStateManager] Updated chain status', {
      txId,
      chain,
      status: updatedChainStatus.status,
    })
  } catch (error) {
    logger.error('[PollingStateManager] Failed to update chain status', {
      txId,
      chain,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Find the latest completed stage across all chains
 * 
 * @param tx - Transaction with polling state
 * @returns Latest completed stage identifier, or undefined if none
 */
export function findLatestCompletedStage(tx: StoredTransaction): string | undefined {
  if (!tx.pollingState) {
    return undefined
  }

  const { chainStatus, flowType } = tx.pollingState
  const chainOrder = getChainOrder(flowType)

  // Iterate through chains in reverse order (most recent first)
  for (let i = chainOrder.length - 1; i >= 0; i--) {
    const chain = chainOrder[i]
    const status = chainStatus[chain]

    if (status?.completedStages && status.completedStages.length > 0) {
      // Return the last completed stage for this chain
      return status.completedStages[status.completedStages.length - 1]
    }
  }

  return undefined
}

/**
 * Determine the next expected stage to poll
 * 
 * @param tx - Transaction with polling state
 * @returns Next expected stage and chain, or undefined if flow is complete
 */
export function determineNextStage(
  tx: StoredTransaction,
): { stage: string; chain: ChainKey } | undefined {
  if (!tx.pollingState) {
    return undefined
  }

  const { flowType } = tx.pollingState
  const chainOrder = getChainOrder(flowType)

  // Find latest completed stage
  const latestStage = findLatestCompletedStage(tx)
  if (!latestStage) {
    // No stages completed yet, start with first chain
    const firstChain = chainOrder[0]
    const expectedStages = getExpectedStages(flowType, firstChain)
    if (expectedStages.length > 0) {
      return {
        stage: expectedStages[0],
        chain: firstChain,
      }
    }
    return undefined
  }

  // Find which chain the latest stage belongs to
  let latestChain: ChainKey | undefined
  for (const chain of chainOrder) {
    const expectedStages = getExpectedStages(flowType, chain)
    if (expectedStages.includes(latestStage as FlowStage)) {
      latestChain = chain
      break
    }
  }

  if (!latestChain) {
    logger.warn('[PollingStateManager] Could not determine chain for latest stage', {
      txId: tx.id,
      latestStage,
    })
    return undefined
  }

  // Check if there's a next stage in the same chain
  const nextStage = getNextStage(latestStage as FlowStage, flowType, latestChain)
  if (nextStage) {
    return {
      stage: nextStage,
      chain: latestChain,
    }
  }

  // No more stages in current chain, move to next chain
  const currentChainIndex = chainOrder.indexOf(latestChain)
  if (currentChainIndex < chainOrder.length - 1) {
    const nextChain = chainOrder[currentChainIndex + 1]
    const expectedStages = getExpectedStages(flowType, nextChain)
    if (expectedStages.length > 0) {
      return {
        stage: expectedStages[0],
        chain: nextChain,
      }
    }
  }

  // Flow is complete
  return undefined
}

/**
 * Get polling state for a transaction
 * 
 * @param txId - Transaction ID
 * @returns Polling state or undefined
 */
export function getPollingState(txId: string): PollingState | undefined {
  const tx = transactionStorageService.getTransaction(txId)
  if (!tx?.pollingState) {
    return undefined
  }
  
  const state = tx.pollingState
  
  // Migration: If metadata exists in chainParams but not in pollingState.metadata, migrate it
  if (!state.metadata) {
    const initialChain = tx.direction === 'deposit' ? 'evm' : 'namada'
    const initialChainMetadata = (state.chainParams as any)?.[initialChain]?.metadata
    
    if (initialChainMetadata && Object.keys(initialChainMetadata).length > 0) {
      logger.info('[PollingStateManager] Migrating metadata from chainParams to pollingState.metadata', {
        txId,
        initialChain,
        metadataKeys: Object.keys(initialChainMetadata),
      })
      
      // Collect metadata from all chains (initial chain has initial metadata, others have result metadata)
      const allMetadata: ChainPollMetadata = { ...initialChainMetadata }
      
      // Merge metadata from other chains (for result metadata like cctpNonce, packetSequence)
      for (const chainKey in state.chainParams) {
        const chain = chainKey as ChainKey
        const chainParams = (state.chainParams as any)[chain]
        if (chainParams?.metadata && chain !== initialChain) {
          Object.assign(allMetadata, chainParams.metadata)
        }
      }
      
      // Update state with migrated metadata
      const migratedState: PollingState = {
        ...state,
        metadata: allMetadata,
      }
      
      // Remove metadata from chainParams (clean up old structure)
      const cleanedChainParams: typeof state.chainParams = {}
      for (const chainKey in state.chainParams) {
        const chain = chainKey as ChainKey
        const chainParams = (state.chainParams as any)[chain]
        if (chainParams) {
          const { metadata, ...rest } = chainParams
          cleanedChainParams[chain] = rest as any
        }
      }
      
      migratedState.chainParams = cleanedChainParams
      
      // Save migrated state
      transactionStorageService.updateTransaction(txId, {
        pollingState: migratedState,
      })
      
      return migratedState
    }
  }
  
  return state
}

/**
 * Initialize polling state for a new transaction
 * 
 * @param txId - Transaction ID
 * @param flowType - Flow type
 * @param initialMetadata - Initial metadata for first chain
 */
export function initializePollingState(
  txId: string,
  flowType: 'deposit' | 'payment',
  initialMetadata?: Record<string, unknown>,
): void {
  const initialState: PollingState = {
    flowStatus: 'pending',
    chainStatus: {},
    flowType,
    chainParams: {},
    metadata: initialMetadata ? (initialMetadata as ChainPollMetadata) : undefined,
    startedAt: Date.now(),
    lastUpdatedAt: Date.now(),
  }

  updatePollingState(txId, initialState)
}

/**
 * Add a stage to a chain's stages array (unified storage)
 * 
 * @param txId - Transaction ID
 * @param chain - Chain key
 * @param stage - Stage to add
 */
export function addChainStage(txId: string, chain: ChainKey, stage: ChainStage): void {
  try {
    const tx = transactionStorageService.getTransaction(txId)
    if (!tx || !tx.pollingState) {
      logger.warn('[PollingStateManager] Transaction or polling state not found for adding stage', {
        txId,
        chain,
      })
      return
    }

    const currentChainStatus = tx.pollingState.chainStatus[chain] ?? {
      status: 'pending',
      completedStages: [],
      stages: [],
    }

    const existingStages = currentChainStatus.stages || []
    const updatedStages = [...existingStages, stage]

    updateChainStatus(txId, chain, {
      stages: updatedStages,
    })

    logger.debug('[PollingStateManager] Added stage to chain', {
      txId,
      chain,
      stage: stage.stage,
      totalStages: updatedStages.length,
    })
  } catch (error) {
    logger.error('[PollingStateManager] Failed to add chain stage', {
      txId,
      chain,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Migrate clientStages to unified pollingState structure
 * 
 * @param txId - Transaction ID
 */
export function migrateClientStagesToUnified(txId: string): void {
  try {
    const tx = transactionStorageService.getTransaction(txId)
    if (!tx || !tx.clientStages || tx.clientStages.length === 0) {
      return
    }

    // Initialize polling state if it doesn't exist
    if (!tx.pollingState) {
      const flowType = tx.direction === 'deposit' ? 'deposit' : 'payment'
      initializePollingState(txId, flowType)
    }

    // Migrate each client stage to the appropriate chain
    for (const clientStage of tx.clientStages) {
      const chain = (clientStage.metadata?.chain as ChainKey) || 'evm'
      addChainStage(txId, chain, clientStage)
    }

    // Remove clientStages field after migration
    transactionStorageService.updateTransaction(txId, {
      clientStages: undefined,
    })

    logger.info('[PollingStateManager] Migrated clientStages to unified structure', {
      txId,
      migratedCount: tx.clientStages.length,
    })
  } catch (error) {
    logger.error('[PollingStateManager] Failed to migrate clientStages', {
      txId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

