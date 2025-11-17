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

export function useTxTracker(options?: { enablePolling?: boolean }) {
  const { enablePolling = true } = options || {}
  logger.debug('[useTxTracker] Hook called', { enablePolling })
  const [txState, setTxState] = useAtom(txAtom)
  const hasStartedInitialPolling = useRef(false)
  const polledTransactionIds = useRef(new Set<string>())

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

      // Sync top-level status with flowStatusSnapshot.status if mismatch detected
      // This fixes existing mismatches where flowStatusSnapshot.status is authoritative but top-level status is stale
      const syncedTxs: StoredTransaction[] = []
      for (const tx of storedTxs) {
        if (tx.flowStatusSnapshot?.status) {
          // Map backend flow status to transaction status
          let expectedStatus: TrackedTransaction['status'] = tx.status
          const flowStatus = tx.flowStatusSnapshot.status
          
          if (flowStatus === 'completed') {
            expectedStatus = 'finalized'
          } else if (flowStatus === 'failed') {
            expectedStatus = 'error'
          } else if (flowStatus === 'undetermined') {
            expectedStatus = 'undetermined'
          } else if (flowStatus === 'pending') {
            // For pending flows, check if we have confirmed stages
            const hasConfirmed =
              tx.flowStatusSnapshot.chainProgress.evm?.stages?.some((s) => s.status === 'confirmed') ||
              tx.flowStatusSnapshot.chainProgress.namada?.stages?.some((s) => s.status === 'confirmed')
            if (hasConfirmed) {
              expectedStatus = 'broadcasted'
            } else {
              expectedStatus = 'submitting'
            }
          }
          
          // If mismatch detected and flowStatusSnapshot.status is a final state, sync top-level status
          if (tx.status !== expectedStatus && 
              (flowStatus === 'completed' || flowStatus === 'failed' || flowStatus === 'undetermined')) {
            logger.info('[useTxTracker] Syncing status mismatch on hydration', {
              txId: tx.id,
              flowId: tx.flowId,
              oldStatus: tx.status,
              newStatus: expectedStatus,
              flowStatusSnapshotStatus: flowStatus,
            })
            
            const syncedTx: StoredTransaction = {
              ...tx,
              status: expectedStatus,
              updatedAt: Date.now(),
            }
            transactionStorageService.saveTransaction(syncedTx)
            syncedTxs.push(syncedTx)
          } else {
            syncedTxs.push(tx)
          }
        } else {
          syncedTxs.push(tx)
        }
      }

      // Convert StoredTransaction[] to TrackedTransaction[] for history
      // (StoredTransaction extends TrackedTransaction, so this is safe)
      const history: TrackedTransaction[] = syncedTxs.map((stored) => ({
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

  const applyStatusMessage = useCallback(
    (message: TxStatusMessage) => {
      // CRITICAL: Update storage FIRST (same pattern as onStatusUpdate and refreshFlowStatus)
      // Get current transaction from storage to merge updates safely
      const currentTx = transactionStorageService.getTransaction(message.txId)
      if (!currentTx) {
        logger.warn('[useTxTracker] Transaction not found in storage for applyStatusMessage', {
          txId: message.txId,
          stage: message.stage,
        })
        return
      }

      const updated: StoredTransaction = {
        ...currentTx,
        status: message.stage,
        errorMessage: undefined, // Clear any previous error message on status update
        updatedAt: Date.now(),
      }

      // Atomic storage update (happens before state update)
      try {
        transactionStorageService.saveTransaction(updated)
        logger.debug('[useTxTracker] Storage updated via applyStatusMessage', {
          txId: message.txId,
          stage: message.stage,
          summary: message.summary,
        })
      } catch (error) {
        logger.error('[useTxTracker] Failed to save transaction to storage in applyStatusMessage', {
          txId: message.txId,
          stage: message.stage,
          error: error instanceof Error ? error.message : String(error),
        })
        return
      }

      // Then update state atom (function updater ensures safe concurrent updates)
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

        // Log when backend timeout is detected via manual refresh
        if (flowStatus.status === 'undetermined') {
          logger.info('[useTxTracker] Server-side timeout detected via refreshFlowStatus (Case 1)', {
            flowId,
            flowStatusStatus: flowStatus.status,
            hasStages: !!(flowStatus.chainProgress.evm?.stages?.length || flowStatus.chainProgress.namada?.stages?.length),
          })
        }

        // Map flow status to transaction status
        let newStatus: TrackedTransaction['status'] = 'submitting'
        if (flowStatus.status === 'completed') {
          newStatus = 'finalized'
        } else if (flowStatus.status === 'failed') {
          newStatus = 'error'
        } else if (flowStatus.status === 'undetermined') {
          newStatus = 'undetermined'
        } else {
          // Check if any chain has confirmed stages
          const hasConfirmed =
            flowStatus.chainProgress.evm?.stages?.some((s) => s.status === 'confirmed') ||
            flowStatus.chainProgress.namada?.stages?.some((s) => s.status === 'confirmed')
          if (hasConfirmed) {
            newStatus = 'broadcasted'
          }
        }

        // CRITICAL: Update storage FIRST (same pattern as onStatusUpdate)
        // Find all transactions with this flowId and update storage
        const allTxs = transactionStorageService.getAllTransactions()
        const matchingTxs = allTxs.filter(
          (tx) => tx.flowId === flowId || tx.flowMetadata?.flowId === flowId,
        )

        if (matchingTxs.length === 0) {
          logger.warn('[useTxTracker] No transactions found for flowId in refreshFlowStatus', {
            flowId,
          })
        }

        for (const tx of matchingTxs) {
          const updated: StoredTransaction = {
            ...tx,
            status: newStatus,
            flowStatusSnapshot: flowStatus, // CRITICAL: Always update flow status snapshot
            flowId: flowStatus.flowId,
            updatedAt: Date.now(),
          }

          try {
            transactionStorageService.saveTransaction(updated)
            
            if (flowStatus.status === 'undetermined') {
              logger.info('[useTxTracker] Storage updated successfully via refreshFlowStatus with undetermined status', {
                txId: tx.id,
                flowId,
                status: newStatus,
                flowStatusSnapshotStatus: updated.flowStatusSnapshot?.status,
                flowStatusSnapshotSet: !!updated.flowStatusSnapshot,
              })
            }
          } catch (error) {
            logger.error('[useTxTracker] Failed to save transaction to storage in refreshFlowStatus', {
              txId: tx.id,
              flowId,
              error: error instanceof Error ? error.message : String(error),
              flowStatusStatus: flowStatus.status,
            })
            // Continue with other transactions even if one fails
          }
        }

        // Then update state atom (function updater ensures safe concurrent updates)
        setTxState((state) => {
          const updateTx = (tx: TrackedTransaction): TrackedTransaction => {
            if (tx.flowId === flowId || tx.flowMetadata?.flowId === flowId) {
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

  // Helper function to start polling for a single transaction
  // Returns cleanup function to stop polling
  const startPollingForTransaction = useCallback(
    (tx: StoredTransaction): (() => void) | null => {
      const txFlowId = tx.flowId!
      const txId = tx.id

      // CRITICAL: Check BOTH polledTransactionIds AND flowStatusPoller to prevent race conditions
      const isAlreadyPolled = polledTransactionIds.current.has(txId)
      const isAlreadyPolling = flowStatusPoller.isPolling(txFlowId)

      logger.debug('[useTxTracker] Processing transaction for polling', {
        txId,
        flowId: txFlowId,
        status: tx.status,
        isAlreadyPolled,
        isAlreadyPolling,
      })

      // Check if already polling to prevent duplicates
      if (isAlreadyPolled || isAlreadyPolling) {
        logger.info('[useTxTracker] Already polling this transaction, skipping', {
          txId,
          flowId: txFlowId,
          reason: isAlreadyPolled ? 'in polledTransactionIds' : 'flowStatusPoller.isPolling',
        })
        return null
      }

      // CRITICAL: Mark as polled IMMEDIATELY to prevent race conditions with concurrent calls
      // This must happen before the async getPollingTimeout() call
      polledTransactionIds.current.add(txId)

      // Clear clientTimeoutAt if it was set (polling is resuming)
      if (tx.clientTimeoutAt) {
        logger.debug('[useTxTracker] Clearing clientTimeoutAt flag - polling resuming', {
          txId,
          flowId: txFlowId,
          previousTimeoutAt: tx.clientTimeoutAt,
        })
        
        // Update transaction in storage to clear timeout flag
        try {
          const currentTx = transactionStorageService.getTransaction(txId)
          if (currentTx) {
            const updatedTx: StoredTransaction = {
              ...currentTx,
              clientTimeoutAt: undefined,
              updatedAt: Date.now(),
            }
            transactionStorageService.saveTransaction(updatedTx)
            logger.info('[useTxTracker] Cleared clientTimeoutAt flag', {
              txId,
              flowId: txFlowId,
            })
          }
        } catch (error) {
          logger.warn('[useTxTracker] Failed to clear clientTimeoutAt flag', {
            txId,
            flowId: txFlowId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      // CRITICAL: Capture tx.id and tx.flowId in closure for isolation
      const txChain = tx.chain
      const txDirection = tx.direction

      logger.debug('[useTxTracker] Setting up polling for transaction', {
        txId,
        flowId: txFlowId,
        chain: txChain,
        direction: txDirection,
        hadClientTimeout: !!tx.clientTimeoutAt,
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

        // Log when backend timeout is detected (Case 1: Server-side timeout)
        if (flowStatus.status === 'undetermined') {
          logger.info('[useTxTracker] Server-side timeout detected via polling (Case 1)', {
            txId,
            flowId: txFlowId,
            flowStatusStatus: flowStatus.status,
            hasStages: !!(flowStatus.chainProgress.evm?.stages?.length || flowStatus.chainProgress.namada?.stages?.length),
            stageCount: {
              evm: flowStatus.chainProgress.evm?.stages?.length || 0,
              namada: flowStatus.chainProgress.namada?.stages?.length || 0,
            },
          })
        }

        // Map flow status to transaction status
        let newStatus: TrackedTransaction['status'] = 'submitting'
        if (flowStatus.status === 'completed') {
          newStatus = 'finalized'
        } else if (flowStatus.status === 'failed') {
          newStatus = 'error'
        } else if (flowStatus.status === 'undetermined') {
          newStatus = 'undetermined'
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

        // Defensive check: Ensure flowStatusSnapshot is always set
        if (!flowStatus) {
          logger.error('[useTxTracker] flowStatus is null/undefined in onStatusUpdate', {
            txId,
            flowId: txFlowId,
          })
          return
        }

        const updated: StoredTransaction = {
          ...currentTx,
          status: newStatus,
          flowStatusSnapshot: flowStatus, // CRITICAL: Always update flow status snapshot
          updatedAt: Date.now(),
        }

        // Defensive check: Verify both fields are updated correctly
        if (updated.status !== newStatus) {
          logger.error('[useTxTracker] Status update mismatch detected', {
            txId,
            flowId: txFlowId,
            expectedStatus: newStatus,
            actualStatus: updated.status,
            flowStatusSnapshotStatus: flowStatus.status,
          })
        }

        // Defensive check: Verify flowStatusSnapshot was set correctly
        if (!updated.flowStatusSnapshot || updated.flowStatusSnapshot.status !== flowStatus.status) {
          logger.error('[useTxTracker] flowStatusSnapshot update mismatch detected', {
            txId,
            flowId: txFlowId,
            expectedFlowStatus: flowStatus.status,
            actualFlowStatusSnapshot: updated.flowStatusSnapshot?.status,
            flowStatusSnapshotSet: !!updated.flowStatusSnapshot,
          })
        }

        // Atomic storage update (happens before state update)
        try {
          transactionStorageService.saveTransaction(updated)

          // Log successful storage update, especially for 'undetermined' status
          if (flowStatus.status === 'undetermined') {
            logger.info('[useTxTracker] Storage updated successfully with undetermined status (Case 1)', {
              txId,
              flowId: txFlowId,
              status: newStatus,
              flowStatusSnapshotStatus: updated.flowStatusSnapshot?.status,
              flowStatusSnapshotSet: !!updated.flowStatusSnapshot,
              stageCount: {
                evm: updated.flowStatusSnapshot?.chainProgress.evm?.stages?.length || 0,
                namada: updated.flowStatusSnapshot?.chainProgress.namada?.stages?.length || 0,
              },
            })
          }
        } catch (error) {
          logger.error('[useTxTracker] Failed to save transaction to storage', {
            txId,
            flowId: txFlowId,
            error: error instanceof Error ? error.message : String(error),
            flowStatusStatus: flowStatus.status,
          })
          return
        }

        // Clean up polling tracking if transaction is completed/failed/undetermined
        if (flowStatus.status === 'completed' || flowStatus.status === 'failed' || flowStatus.status === 'undetermined') {
          logger.debug('[useTxTracker] Transaction completed, removing from polled tracking', {
            txId,
            flowId: txFlowId,
            finalStatus: flowStatus.status,
          })
          polledTransactionIds.current.delete(txId)
        }

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

        logger.info('[useTxTracker] Client-side polling timeout occurred (Case 2)', {
          txId,
          flowId: txFlowId,
          chain: txChain,
          direction: txDirection,
        })

        // CRITICAL: Attempt to fetch latest flow status from backend before marking as 'undetermined'
        // This handles the case where backend might have updated status but frontend can't reach it
        let latestFlowStatus: FlowStatus | null = null
        let fetchSucceeded = false

        try {
          logger.debug('[useTxTracker] Attempting to fetch latest flow status before timeout update', {
            txId,
            flowId: txFlowId,
          })

          latestFlowStatus = await getFlowStatus(txFlowId)
          fetchSucceeded = true

          logger.info('[useTxTracker] Successfully fetched latest flow status on timeout', {
            txId,
            flowId: txFlowId,
            flowStatusStatus: latestFlowStatus.status,
            hasStages: !!(latestFlowStatus.chainProgress.evm?.stages?.length || latestFlowStatus.chainProgress.namada?.stages?.length),
          })

          // Update cache with latest status
          flowStatusCacheService.cacheFlowStatus(txFlowId, latestFlowStatus)
        } catch (error) {
          // Network error or backend unresponsive - this is expected in Case 2
          logger.warn('[useTxTracker] Failed to fetch latest flow status on timeout (expected for client-side timeout)', {
            txId,
            flowId: txFlowId,
            error: error instanceof Error ? error.message : String(error),
            errorType: error instanceof Error ? error.constructor.name : typeof error,
          })

          // Try to get cached status as fallback
          const cachedStatus = flowStatusCacheService.getCachedFlowStatus(txFlowId)
          if (cachedStatus) {
            logger.debug('[useTxTracker] Using cached flow status as fallback', {
              txId,
              flowId: txFlowId,
              cachedStatus: cachedStatus.status,
            })
            latestFlowStatus = cachedStatus
          }
        }

        // Get current transaction from storage
        const currentTx = transactionStorageService.getTransaction(txId)
        if (!currentTx) {
          logger.warn('[useTxTracker] Transaction not found in storage for timeout', { txId })
          return
        }

        // Determine final status and flowStatusSnapshot
        let finalStatus: TrackedTransaction['status'] = 'undetermined'
        let finalFlowStatusSnapshot: FlowStatus | undefined

        if (latestFlowStatus) {
          // We have latest status from backend (either fetched or cached)
          // Map flow status to transaction status
          if (latestFlowStatus.status === 'completed') {
            finalStatus = 'finalized'
          } else if (latestFlowStatus.status === 'failed') {
            finalStatus = 'error'
          } else if (latestFlowStatus.status === 'undetermined') {
            finalStatus = 'undetermined'
          } else {
            const hasConfirmed =
              latestFlowStatus.chainProgress.evm?.stages?.some((s) => s.status === 'confirmed') ||
              latestFlowStatus.chainProgress.namada?.stages?.some((s) => s.status === 'confirmed')
            if (hasConfirmed) {
              finalStatus = 'broadcasted'
            } else {
              finalStatus = 'submitting'
            }
          }
          finalFlowStatusSnapshot = latestFlowStatus
        } else {
          // No latest status available (network error, backend unresponsive)
          // Mark as 'undetermined' but preserve existing flowStatusSnapshot if available
          finalStatus = 'undetermined'
          finalFlowStatusSnapshot = currentTx.flowStatusSnapshot

          logger.info('[useTxTracker] No latest status available, marking as undetermined', {
            txId,
            flowId: txFlowId,
            hasExistingSnapshot: !!currentTx.flowStatusSnapshot,
            existingSnapshotStatus: currentTx.flowStatusSnapshot?.status,
          })
        }

        const updated: StoredTransaction = {
          ...currentTx,
          status: finalStatus,
          flowStatusSnapshot: finalFlowStatusSnapshot, // Update or preserve flowStatusSnapshot
          clientTimeoutAt: Date.now(), // Mark that client-side timeout occurred
          updatedAt: Date.now(),
        }

        // Defensive check: Verify flowStatusSnapshot is set correctly
        if (latestFlowStatus && (!updated.flowStatusSnapshot || updated.flowStatusSnapshot.status !== latestFlowStatus.status)) {
          logger.error('[useTxTracker] flowStatusSnapshot update mismatch in onTimeout', {
            txId,
            flowId: txFlowId,
            expectedFlowStatus: latestFlowStatus.status,
            actualFlowStatusSnapshot: updated.flowStatusSnapshot?.status,
            flowStatusSnapshotSet: !!updated.flowStatusSnapshot,
          })
        }

        // Atomic storage update
        try {
          transactionStorageService.saveTransaction(updated)

          logger.info('[useTxTracker] Storage updated after client-side timeout (Case 2)', {
            txId,
            flowId: txFlowId,
            status: finalStatus,
            flowStatusSnapshotStatus: updated.flowStatusSnapshot?.status,
            flowStatusSnapshotSet: !!updated.flowStatusSnapshot,
            clientTimeoutAt: updated.clientTimeoutAt,
            fetchSucceeded,
            usedCachedStatus: !fetchSucceeded && !!latestFlowStatus,
            stageCount: {
              evm: updated.flowStatusSnapshot?.chainProgress.evm?.stages?.length || 0,
              namada: updated.flowStatusSnapshot?.chainProgress.namada?.stages?.length || 0,
            },
          })
        } catch (error) {
          logger.error('[useTxTracker] Failed to save transaction to storage on timeout', {
            txId,
            flowId: txFlowId,
            error: error instanceof Error ? error.message : String(error),
          })
          return
        }

        // Clean up polling tracking for timed out transaction
        logger.debug('[useTxTracker] Transaction timed out, removing from polled tracking', {
          txId,
          flowId: txFlowId,
        })
        polledTransactionIds.current.delete(txId)

        // Then update state atom
        setTxState((state) => {
          const updateTx = (txItem: TrackedTransaction): TrackedTransaction => {
            if (txItem.id === txId && txItem.flowId === txFlowId) {
              return {
                ...txItem,
                status: finalStatus,
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

      // Create a promise-based wrapper to handle async timeout configuration
      let cleanupFn: (() => void) | null = null

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
          // Note: polledTransactionIds was already marked above to prevent race conditions
          flowStatusPoller.startPolling(txFlowId, onStatusUpdate, onTimeout, timeoutMs)

          const isPolling = flowStatusPoller.isPolling(txFlowId)
          logger.debug('[useTxTracker] Polling started successfully', {
            txId,
            flowId: txFlowId,
            isPolling,
          })

          // Store cleanup function
          cleanupFn = () => {
            logger.debug('[useTxTracker] Cleanup: stopping polling', {
              txId,
              flowId: txFlowId,
            })
            flowStatusPoller.stopPolling(txFlowId)
            // Note: We don't remove from polledTransactionIds here because
            // the transaction might still be in progress and could be polled again
          }
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

          // Note: polledTransactionIds was already marked above to prevent race conditions
          flowStatusPoller.startPolling(txFlowId, onStatusUpdate, onTimeout)

          logger.debug('[useTxTracker] Polling started successfully (fallback)', {
            txId,
            flowId: txFlowId,
            isPolling: flowStatusPoller.isPolling(txFlowId),
          })

          cleanupFn = () => {
            logger.debug('[useTxTracker] Cleanup: stopping polling (fallback)', {
              txId,
              flowId: txFlowId,
            })
            flowStatusPoller.stopPolling(txFlowId)
          }
        })

      // Return cleanup function (will be set asynchronously, but caller can store it)
      // For immediate return, we return a function that will call the actual cleanup when ready
      return () => {
        if (cleanupFn) {
          cleanupFn()
        } else {
          // If cleanup not ready yet, stop polling directly
          logger.debug('[useTxTracker] Cleanup called before timeout config loaded, stopping polling directly', {
            txId,
            flowId: txFlowId,
          })
          flowStatusPoller.stopPolling(txFlowId)
        }
      }
    },
    [setTxState],
  )

  // Helper function to start polling for in-progress transactions
  const startPollingForTransactions = useCallback(() => {
    logger.debug('[useTxTracker] startPollingForTransactions called', {
      hasStartedInitialPolling: hasStartedInitialPolling.current,
      alreadyPolledTxIds: Array.from(polledTransactionIds.current),
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
    // AND that haven't been polled yet (prevent duplicate polling)
    const pollableTxs = inProgressTxs.filter((tx) => {
      const hasFlowId = !!tx.flowId
      const isNotFrontendOnly = !tx.isFrontendOnly
      const hasBeenPolled = polledTransactionIds.current.has(tx.id)
      const isPollable = hasFlowId && isNotFrontendOnly && !hasBeenPolled

      if (!isPollable) {
        logger.debug('[useTxTracker] Transaction filtered out', {
          txId: tx.id,
          status: tx.status,
          hasFlowId,
          isFrontendOnly: tx.isFrontendOnly,
          hasBeenPolled,
          reason: !hasFlowId ? 'missing flowId' : !isNotFrontendOnly ? 'isFrontendOnly' : 'already polled',
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

    // Start independent polling job for each transaction using helper function
    const cleanupFunctions: Array<() => void> = []

    for (const tx of pollableTxs) {
      const cleanupFn = startPollingForTransaction(tx)
      if (cleanupFn) {
        cleanupFunctions.push(cleanupFn)
      }
    }

    return cleanupFunctions
  }, [startPollingForTransaction])

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

      // Start polling for new transactions if they have a flowId
      // NOTE: We don't check enablePolling here because polling is managed globally by the App-level hook instance.
      // Page-level hooks (like Deposit/SendPayment) disable polling to avoid duplicate effects, but transactions
      // should still start polling when submitted. The global polling instance will handle the actual polling.
      if (input.flowId) {
        // Read transaction from storage to get full StoredTransaction object (includes isFrontendOnly)
        // Note: Transaction was just saved above, so it should be available
        const storedTx = transactionStorageService.getTransaction(input.id)
        
        // Check if this transaction should be polled
        // Must have flowId, not be frontend-only, and not already polled
        if (storedTx && !storedTx.isFrontendOnly) {
          const isAlreadyPolled = polledTransactionIds.current.has(input.id)
          const isAlreadyPolling = flowStatusPoller.isPolling(input.flowId)
          
          if (!isAlreadyPolled && !isAlreadyPolling) {
            logger.debug('[useTxTracker] New transaction detected in upsertTransaction, starting polling', {
              txId: input.id,
              flowId: input.flowId,
              status: input.status,
            })
            // Call helper directly with the transaction object
            startPollingForTransaction(storedTx)
          } else {
            logger.debug('[useTxTracker] Transaction already being polled, skipping', {
              txId: input.id,
              flowId: input.flowId,
              isAlreadyPolled,
              isAlreadyPolling,
            })
          }
        } else if (storedTx?.isFrontendOnly) {
          logger.debug('[useTxTracker] Transaction is frontend-only, skipping polling', {
            txId: input.id,
            flowId: input.flowId,
          })
        } else {
          logger.warn('[useTxTracker] Transaction not found in storage for polling', {
            txId: input.id,
            flowId: input.flowId,
          })
        }
      }
    },
    [setTxState, startPollingForTransaction],
  )

  // Poll in-progress transactions that haven't been polled yet
  // This effect runs:
  // 1. On mount (to resume polling for in-progress transactions after page refresh)
  // 2. When enablePolling changes
  // 
  // IMPORTANT: We do NOT depend on txState.history because:
  // - Status updates change history, causing unnecessary re-runs
  // - startPollingForTransactions reads directly from storage (source of truth)
  // - Duplicate prevention is handled by polledTransactionIds ref and flowStatusPoller.isPolling()
  // - New transactions added via upsertTransaction will be picked up on next mount/refresh
  useEffect(() => {
    if (!enablePolling) {
      logger.debug('[useTxTracker] Polling disabled for this hook instance')
      return
    }

    logger.debug('[useTxTracker] Polling effect triggered', {
      hasStartedInitialPolling: hasStartedInitialPolling.current,
      alreadyPolledTxIds: Array.from(polledTransactionIds.current),
    })

    const cleanupFunctions = startPollingForTransactions()

    logger.debug('[useTxTracker] Polling effect completed', {
      cleanupFunctionsCount: cleanupFunctions.length,
    })

    // Cleanup: stop all polling jobs on unmount or when enablePolling changes
    return () => {
      logger.debug('[useTxTracker] Cleaning up polling jobs', {
        count: cleanupFunctions.length,
      })
      for (const cleanup of cleanupFunctions) {
        cleanup()
      }
    }
  }, [enablePolling, startPollingForTransactions]) // Removed txState.history dependency to prevent re-runs on status updates
  // Note: This effect reads directly from storage to resume polling for in-progress transactions

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
