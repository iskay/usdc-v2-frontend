import { useCallback, useEffect, useRef } from 'react'
import { useAtom } from 'jotai'
import { txAtom } from '@/atoms/txAtom'
import type { TrackedTransaction, TxStatusMessage } from '@/types/tx'
import type { FlowStatus } from '@/types/flow'
import { flowStatusPoller } from '@/services/flow/flowStatusPoller'
import { getFlowStatus } from '@/services/api/backendClient'
import { flowStatusCacheService } from '@/services/flow/flowStatusCacheService'
import { transactionStorageService, type StoredTransaction } from '@/services/tx/transactionStorageService'
import { chainConfigAtom } from '@/atoms/appAtom'
import { findChainByKey } from '@/config/chains'
import { fetchTendermintChainsConfig } from '@/services/config/tendermintChainConfigService'
import { jotaiStore } from '@/store/jotaiStore'
import { logger } from '@/utils/logger'

/**
 * Get polling timeout for a transaction based on chain and direction.
 * Returns timeout in milliseconds, or undefined if not configured.
 * Default: 20 minutes (1200000ms) if not configured.
 */
async function getPollingTimeout(
  chainKey: string,
  direction: 'deposit' | 'send',
): Promise<number> {
  const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000 // 20 minutes

  try {
    // Check EVM chains first
    const evmChainConfig = jotaiStore.get(chainConfigAtom)
    if (evmChainConfig) {
      const chain = findChainByKey(evmChainConfig, chainKey)
      if (chain?.pollingTimeout) {
        const timeoutMs =
          direction === 'deposit'
            ? chain.pollingTimeout.depositTimeoutMs
            : chain.pollingTimeout.paymentTimeoutMs
        if (timeoutMs !== undefined && timeoutMs > 0) {
          return timeoutMs
        }
      }
    }

    // Check Tendermint chains
    const tendermintConfig = await fetchTendermintChainsConfig()
    const tendermintChain = tendermintConfig.chains.find((c) => c.key === chainKey)
    if (tendermintChain?.pollingTimeout) {
      const timeoutMs =
        direction === 'deposit'
          ? tendermintChain.pollingTimeout.depositTimeoutMs
          : tendermintChain.pollingTimeout.paymentTimeoutMs
      if (timeoutMs !== undefined && timeoutMs > 0) {
        return timeoutMs
      }
    }

    // Return default if not configured
    return DEFAULT_TIMEOUT_MS
  } catch (error) {
    logger.warn('[useTxTracker] Failed to get polling timeout, using default', {
      chainKey,
      direction,
      error: error instanceof Error ? error.message : String(error),
    })
    return DEFAULT_TIMEOUT_MS
  }
}

export function useTxTracker() {
  logger.debug('[useTxTracker] Hook called')
  const [txState, setTxState] = useAtom(txAtom)
  const hasStartedInitialPolling = useRef(false)

  // Hydrate transaction state from localStorage on mount
  useEffect(() => {
    logger.debug('[useTxTracker] Starting hydration effect')
    try {
      const storedTxs = transactionStorageService.getAllTransactions()
      
      if (storedTxs.length === 0) {
        logger.debug('[useTxTracker] No stored transactions found')
        return
      }

      logger.info('[useTxTracker] Hydrating transactions from storage', {
        count: storedTxs.length,
      })

      // Convert StoredTransaction[] to TrackedTransaction[] for history
      // (StoredTransaction extends TrackedTransaction, so this is safe)
      const history: TrackedTransaction[] = storedTxs.map((stored) => ({
        id: stored.id,
        createdAt: stored.createdAt,
        updatedAt: stored.updatedAt,
        chain: stored.chain,
        direction: stored.direction,
        status: stored.status,
        hash: stored.hash,
        errorMessage: stored.errorMessage,
        flowId: stored.flowId,
        flowMetadata: stored.flowMetadata,
      }))

      // Note: activeTransaction concept is deprecated - all in-progress transactions are polled in parallel
      // Keeping it for backward compatibility but it's no longer the primary mechanism
      const inProgressTxs = transactionStorageService.getInProgressTransactions()
      const activeTx = inProgressTxs.length > 0 ? inProgressTxs[0] : undefined

      setTxState({
        activeTransaction: activeTx,
        history,
      })

      logger.info('[useTxTracker] Transactions hydrated successfully', {
        totalCount: history.length,
        activeTransactionId: activeTx?.id,
        inProgressCount: inProgressTxs.length,
      })
    } catch (error) {
      logger.error('[useTxTracker] Failed to hydrate transactions', {
        error: error instanceof Error ? error.message : String(error),
      })
      // Don't throw - allow app to continue without hydrated transactions
    }
  }, [setTxState]) // Only run once on mount

  const upsertTransaction = useCallback(
    (input: TrackedTransaction) => {
      setTxState((state) => {
        const history = state.history.filter((item) => item.id !== input.id)
        // Ensure updatedAt is set when upserting
        const updatedTx: TrackedTransaction = {
          ...input,
          updatedAt: Date.now(),
        }
        
        // Also save to unified storage
        try {
          transactionStorageService.saveTransaction(updatedTx as any) // Cast to StoredTransaction (will have additional fields)
        } catch (error) {
          logger.warn('[useTxTracker] Failed to save transaction to storage', {
            txId: updatedTx.id,
            error: error instanceof Error ? error.message : String(error),
          })
        }
        
        return { ...state, activeTransaction: updatedTx, history: [updatedTx, ...history] }
      })
    },
    [setTxState],
  )

  const applyStatusMessage = useCallback(
    (message: TxStatusMessage) => {
      setTxState((state) => ({
        ...state,
        activeTransaction:
          state.activeTransaction && state.activeTransaction.id === message.txId
            ? { ...state.activeTransaction, status: message.stage, errorMessage: undefined, updatedAt: Date.now() }
            : state.activeTransaction,
        history: state.history.map((tx) =>
          tx.id === message.txId
            ? { ...tx, status: message.stage, errorMessage: undefined, updatedAt: Date.now() }
            : tx,
        ),
      }))
    },
    [setTxState],
  )

  const refreshFlowStatus = useCallback(
    async (flowId: string) => {
      try {
        const flowStatus = await getFlowStatus(flowId)
        flowStatusCacheService.cacheFlowStatus(flowId, flowStatus)

        // Find transaction by flowId and update status
        setTxState((state) => {
          const updateTx = (tx: TrackedTransaction): TrackedTransaction => {
            if (tx.flowId === flowId || tx.flowMetadata?.flowId === flowId) {
              // Map flow status to transaction status
              let newStatus: TrackedTransaction['status'] = 'submitting'
              if (flowStatus.status === 'completed') {
                newStatus = 'finalized'
              } else if (flowStatus.status === 'failed') {
                newStatus = 'error'
              } else {
                // Check if any chain has confirmed stages
                const hasConfirmed =
                  flowStatus.chainProgress.evm?.stages?.some((s) => s.status === 'confirmed') ||
                  flowStatus.chainProgress.namada?.stages?.some((s) => s.status === 'confirmed')
                if (hasConfirmed) {
                  newStatus = 'broadcasted'
                }
              }

              return {
                ...tx,
                status: newStatus,
                flowId: flowStatus.flowId,
                updatedAt: Date.now(),
              }
            }
            return tx
          }

          return {
            ...state,
            activeTransaction: state.activeTransaction
              ? updateTx(state.activeTransaction)
              : undefined,
            history: state.history.map(updateTx),
          }
        })
      } catch (error) {
        logger.warn('[useTxTracker] Failed to refresh flow status', {
          flowId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [setTxState],
  )

  // Helper function to start polling for in-progress transactions
  const startPollingForTransactions = useCallback(() => {
    logger.debug('[useTxTracker] startPollingForTransactions called', {
      hasStartedInitialPolling: hasStartedInitialPolling.current,
    })

    const inProgressTxs = transactionStorageService.getInProgressTransactions()
    logger.debug('[useTxTracker] Found in-progress transactions from storage', {
      count: inProgressTxs.length,
      transactions: inProgressTxs.map((tx) => ({
        id: tx.id,
        status: tx.status,
        flowId: tx.flowId,
        isFrontendOnly: tx.isFrontendOnly,
        chain: tx.chain,
        direction: tx.direction,
      })),
    })
    
    // Filter to only transactions with flowId (can't poll without flowId)
    const pollableTxs = inProgressTxs.filter((tx) => {
      const hasFlowId = !!tx.flowId
      const isNotFrontendOnly = !tx.isFrontendOnly
      const isPollable = hasFlowId && isNotFrontendOnly
      
      if (!isPollable) {
        logger.debug('[useTxTracker] Transaction filtered out', {
          txId: tx.id,
          status: tx.status,
          hasFlowId,
          isFrontendOnly: tx.isFrontendOnly,
          reason: !hasFlowId ? 'missing flowId' : 'isFrontendOnly',
        })
      }
      
      return isPollable
    })

    logger.debug('[useTxTracker] Filtered to pollable transactions', {
      pollableCount: pollableTxs.length,
      pollableTxs: pollableTxs.map((tx) => ({
        id: tx.id,
        flowId: tx.flowId,
        status: tx.status,
      })),
    })

    if (pollableTxs.length === 0) {
      logger.info('[useTxTracker] No pollable transactions found after filtering', {
        inProgressCount: inProgressTxs.length,
        reasons: inProgressTxs.map((tx) => ({
          id: tx.id,
          hasFlowId: !!tx.flowId,
          isFrontendOnly: tx.isFrontendOnly,
        })),
      })
      return []
    }

    const isInitialPolling = !hasStartedInitialPolling.current
    if (isInitialPolling) {
      logger.info('[useTxTracker] Starting initial polling for in-progress transactions on app startup', {
        count: pollableTxs.length,
        txIds: pollableTxs.map((tx) => tx.id),
        flowIds: pollableTxs.map((tx) => tx.flowId),
      })
      hasStartedInitialPolling.current = true
    } else {
      logger.info('[useTxTracker] Starting polling for in-progress transactions', {
        count: pollableTxs.length,
        txIds: pollableTxs.map((tx) => tx.id),
        flowIds: pollableTxs.map((tx) => tx.flowId),
      })
    }

    // Start independent polling job for each transaction
    const cleanupFunctions: Array<() => void> = []

    for (const tx of pollableTxs) {
      const txFlowId = tx.flowId!
      const isAlreadyPolling = flowStatusPoller.isPolling(txFlowId)
      
      logger.debug('[useTxTracker] Processing transaction for polling', {
        txId: tx.id,
        flowId: txFlowId,
        status: tx.status,
        isAlreadyPolling,
      })

      // Check if already polling to prevent duplicates
      if (isAlreadyPolling) {
        logger.info('[useTxTracker] Already polling this flowId, skipping', {
          txId: tx.id,
          flowId: txFlowId,
        })
        continue
      }

      // CRITICAL: Capture tx.id and tx.flowId in closure for isolation
      const txId = tx.id
      const txChain = tx.chain
      const txDirection = tx.direction

      logger.debug('[useTxTracker] Setting up polling for transaction', {
        txId,
        flowId: txFlowId,
        chain: txChain,
        direction: txDirection,
      })

      // Set up status update callback with closure isolation
      const onStatusUpdate = async (polledFlowId: string, flowStatus: FlowStatus) => {
        // Safety check: only update if flowId matches (prevents cross-transaction updates)
        if (polledFlowId !== txFlowId) {
          logger.warn('[useTxTracker] Received update for different flowId', {
            expected: txFlowId,
            received: polledFlowId,
            txId,
          })
          return
        }

        // Map flow status to transaction status
        let newStatus: TrackedTransaction['status'] = 'submitting'
        if (flowStatus.status === 'completed') {
          newStatus = 'finalized'
        } else if (flowStatus.status === 'failed') {
          newStatus = 'error'
        } else {
          const hasConfirmed =
            flowStatus.chainProgress.evm?.stages?.some((s) => s.status === 'confirmed') ||
            flowStatus.chainProgress.namada?.stages?.some((s) => s.status === 'confirmed')
          if (hasConfirmed) {
            newStatus = 'broadcasted'
          }
        }

        // CRITICAL: Update storage FIRST (atomic operation, prevents race conditions)
        // Get current transaction from storage to merge updates safely
        const currentTx = transactionStorageService.getTransaction(txId)
        if (!currentTx) {
          logger.warn('[useTxTracker] Transaction not found in storage', { txId })
          return
        }

        const updated: StoredTransaction = {
          ...currentTx,
          status: newStatus,
          flowStatusSnapshot: flowStatus, // Update flow status snapshot
          updatedAt: Date.now(),
        }

        // Atomic storage update (happens before state update)
        transactionStorageService.saveTransaction(updated)

        // Then update state atom (function updater ensures safe concurrent updates)
        setTxState((state) => {
          const updateTx = (txItem: TrackedTransaction): TrackedTransaction => {
            // Match by both id AND flowId for extra safety
            if (txItem.id === txId && txItem.flowId === txFlowId) {
              return {
                ...txItem,
                status: newStatus,
                updatedAt: Date.now(),
              }
            }
            return txItem
        }

        return {
          ...state,
            activeTransaction: state.activeTransaction ? updateTx(state.activeTransaction) : undefined,
            history: state.history.map(updateTx),
          }
        })
      }

      // Set up timeout callback with closure isolation
      const onTimeout = async (polledFlowId: string) => {
        // Safety check: only update if flowId matches
        if (polledFlowId !== txFlowId) {
          logger.warn('[useTxTracker] Received timeout for different flowId', {
            expected: txFlowId,
            received: polledFlowId,
            txId,
          })
          return
        }

        logger.info('[useTxTracker] Polling timeout for transaction', {
          txId,
          flowId: txFlowId,
          chain: txChain,
          direction: txDirection,
        })

        // CRITICAL: Update storage FIRST
        const currentTx = transactionStorageService.getTransaction(txId)
        if (!currentTx) {
          logger.warn('[useTxTracker] Transaction not found in storage for timeout', { txId })
          return
        }

        const updated: StoredTransaction = {
          ...currentTx,
          status: 'undetermined',
          updatedAt: Date.now(),
        }

        // Atomic storage update
        transactionStorageService.saveTransaction(updated)

        // Then update state atom
        setTxState((state) => {
          const updateTx = (txItem: TrackedTransaction): TrackedTransaction => {
            if (txItem.id === txId && txItem.flowId === txFlowId) {
              return {
                ...txItem,
                status: 'undetermined',
                updatedAt: Date.now(),
              }
            }
            return txItem
          }

          return {
            ...state,
            activeTransaction: state.activeTransaction ? updateTx(state.activeTransaction) : undefined,
            history: state.history.map(updateTx),
        }
      })
    }

      // Get timeout for this transaction
      logger.debug('[useTxTracker] Getting polling timeout configuration', {
        txId,
        flowId: txFlowId,
        chain: txChain,
        direction: txDirection,
      })

      getPollingTimeout(txChain, txDirection)
        .then((timeoutMs) => {
          logger.info('[useTxTracker] Starting polling with timeout', {
            txId,
            flowId: txFlowId,
            timeoutMs,
            chain: txChain,
            direction: txDirection,
          })

          // Start polling with timeout
          flowStatusPoller.startPolling(txFlowId, onStatusUpdate, onTimeout, timeoutMs)

          const isPolling = flowStatusPoller.isPolling(txFlowId)
          logger.debug('[useTxTracker] Polling started successfully', {
            txId,
            flowId: txFlowId,
            isPolling,
          })

          // Store cleanup function
          cleanupFunctions.push(() => {
            logger.debug('[useTxTracker] Cleanup: stopping polling', {
              txId,
              flowId: txFlowId,
            })
            flowStatusPoller.stopPolling(txFlowId)
          })
        })
        .catch((error) => {
          logger.error('[useTxTracker] Failed to get polling timeout, starting without timeout', {
            txId,
            flowId: txFlowId,
            chain: txChain,
            direction: txDirection,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          })
          
          // Start polling without timeout as fallback
          logger.info('[useTxTracker] Starting polling without timeout (fallback)', {
            txId,
            flowId: txFlowId,
          })
          
          flowStatusPoller.startPolling(txFlowId, onStatusUpdate, onTimeout)
          
          logger.debug('[useTxTracker] Polling started successfully (fallback)', {
            txId,
            flowId: txFlowId,
            isPolling: flowStatusPoller.isPolling(txFlowId),
          })

          cleanupFunctions.push(() => {
            logger.debug('[useTxTracker] Cleanup: stopping polling (fallback)', {
              txId,
              flowId: txFlowId,
            })
            flowStatusPoller.stopPolling(txFlowId)
          })
        })
    }

    return cleanupFunctions
  }, [setTxState]) // setTxState is stable from useAtom, but included for completeness

  // Poll ALL in-progress transactions in parallel
  // This effect runs:
  // 1. On mount (to resume polling for in-progress transactions after page refresh)
  // 2. When txState.history changes (to start polling for newly added transactions)
  useEffect(() => {
    logger.debug('[useTxTracker] Polling effect triggered', {
      txStateHistoryLength: txState.history.length,
      hasStartedInitialPolling: hasStartedInitialPolling.current,
      historyTxIds: txState.history.map((tx) => tx.id),
    })

    const cleanupFunctions = startPollingForTransactions()

    logger.debug('[useTxTracker] Polling effect completed', {
      cleanupFunctionsCount: cleanupFunctions.length,
    })

    // Cleanup: stop all polling jobs on unmount or when transactions change
    return () => {
      logger.debug('[useTxTracker] Cleaning up polling jobs', {
        count: cleanupFunctions.length,
      })
      for (const cleanup of cleanupFunctions) {
        cleanup()
      }
    }
  }, [txState.history, startPollingForTransactions]) // Re-run when history changes (new transactions added)
  // Note: This effect also runs on mount, reading directly from storage to resume polling
  // for in-progress transactions after page refresh

  const clearActive = useCallback(() => {
    // Stop polling before clearing
    if (txState.activeTransaction?.flowId) {
      flowStatusPoller.stopPolling(txState.activeTransaction.flowId)
    }
    setTxState((state) => ({ ...state, activeTransaction: undefined }))
  }, [setTxState, txState.activeTransaction?.flowId])

  /**
   * Re-poll an undetermined transaction.
   * This is a stub/hook for future implementation.
   * 
   * TODO: Implement re-polling functionality for undetermined transactions.
   * This should:
   * 1. Check if transaction has flowId (can't poll without it)
   * 2. Reset status from 'undetermined' to 'submitting' or 'broadcasted'
   * 3. Start polling with appropriate timeout
   * 4. Update storage and state accordingly
   * 
   * @param txId - Transaction ID to re-poll
   */
  const retryPollingUndetermined = useCallback(
    async (txId: string): Promise<void> => {
      logger.info('[useTxTracker] Retry polling requested for undetermined transaction', { txId })
      
      const tx = transactionStorageService.getTransaction(txId)
      if (!tx) {
        logger.warn('[useTxTracker] Transaction not found for retry', { txId })
        return
      }

      if (tx.status !== 'undetermined') {
        logger.warn('[useTxTracker] Transaction is not undetermined, cannot retry', {
          txId,
          status: tx.status,
        })
        return
      }

      if (!tx.flowId) {
        logger.warn('[useTxTracker] Transaction has no flowId, cannot retry polling', { txId })
        return
      }

      // TODO: Implement re-polling logic
      // For now, just log that this feature is not yet implemented
      logger.info('[useTxTracker] Re-polling functionality not yet implemented', {
        txId,
        flowId: tx.flowId,
        chain: tx.chain,
        direction: tx.direction,
      })

      // Stub: This will be implemented in a future task
      // The implementation should:
      // 1. Reset transaction status to appropriate in-progress state
      // 2. Start polling with timeout
      // 3. Update storage and state
    },
    [],
  )

  return {
    state: txState,
    upsertTransaction,
    applyStatusMessage,
    clearActive,
    refreshFlowStatus,
    retryPollingUndetermined, // Expose re-polling hook
  }
}
