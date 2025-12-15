import { useEffect, useState, useCallback, useRef } from 'react'
import { transactionStorageService, type StoredTransaction } from '@/services/tx/transactionStorageService'
import { TransactionCard } from './TransactionCard'
import { Spinner } from '@/components/common/Spinner'
import { useDeleteTransaction } from '@/hooks/useDeleteTransaction'
import { cn } from '@/lib/utils'

export interface TxHistoryListProps {
  openModalTxId?: string | null
  onModalOpenChange?: (txId: string | null) => void
  reloadTrigger?: number // When changed, triggers immediate reload
  hideActions?: boolean // Hide the actions column (dropdown menu)
}

// Duration for fade-in animation (in milliseconds)
const FADE_IN_DURATION = 500 // 500ms
// Delay before starting fade-in (wait for fade-out to complete in In Progress list)
const FADE_OUT_DURATION = 500 // 500ms (should match COMPLETION_DISPLAY_DURATION in TxInProgressList)

export function TxHistoryList({ openModalTxId, onModalOpenChange, reloadTrigger, hideActions = false }: TxHistoryListProps = {}) {
  const [completedTxs, setCompletedTxs] = useState<StoredTransaction[]>([])
  const [newlyAddedTxs, setNewlyAddedTxs] = useState<Map<string, { addedAt: number }>>(new Map())
  const [_fadeTick, setFadeTick] = useState(0) // Force re-render for fade animation
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { deleteTransaction } = useDeleteTransaction()
  const previousTxIdsRef = useRef<Set<string>>(new Set())
  const isInitialLoadRef = useRef(true) // Track if this is the initial load

  const loadTransactions = useCallback(() => {
    try {
      const txs = transactionStorageService.getCompletedTransactions(5)
      const currentTxIds = new Set(txs.map(tx => tx.id))
      
      // Find newly added transactions (only track after initial load)
      const newIds = Array.from(currentTxIds).filter(
        id => !previousTxIdsRef.current.has(id)
      )
      
      // Track newly added transactions for fade-in
      // Only track if this is NOT the initial load (skip fade-in for transactions present on page load)
      if (!isInitialLoadRef.current && newIds.length > 0) {
        setNewlyAddedTxs(prev => {
          const updated = new Map(prev)
          const now = Date.now()
          newIds.forEach(id => {
            // Only add if not already tracking it
            if (!updated.has(id)) {
              // Store when it appeared, fade-in will start after FADE_OUT_DURATION
              updated.set(id, { addedAt: now })
            }
          })
          return updated
        })
      }
      
      // Mark initial load as complete after first load
      if (isInitialLoadRef.current) {
        isInitialLoadRef.current = false
      }
      
      // Remove old entries that are no longer in the list
      setNewlyAddedTxs(prev => {
        const updated = new Map(prev)
        prev.forEach((_, id) => {
          if (!currentTxIds.has(id)) {
            updated.delete(id)
          }
        })
        return updated
      })
      
      // Update previous IDs for next comparison
      previousTxIdsRef.current = currentTxIds
      
      setCompletedTxs(txs)
      setIsLoading(false)
      setError(null)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load transactions'
      console.error('[TxHistoryList] Failed to load transactions', err)
      setError(errorMessage)
      setIsLoading(false)
    }
  }, [])

  // Load completed transactions from unified storage (limit to 5 most recent)
  useEffect(() => {
    // Load initially
    loadTransactions()

    // Reload periodically to catch updates (synchronized: 5 seconds to match In Progress)
    const interval = setInterval(loadTransactions, 5000)
    return () => clearInterval(interval)
  }, [loadTransactions])

  // Trigger fade-in animation updates
  useEffect(() => {
    if (newlyAddedTxs.size === 0) return

    // Set up interval to update fade animation
    const interval = setInterval(() => {
      const now = Date.now()
      
      // Update fade tick to trigger re-render for smooth opacity transition
      setFadeTick(prev => prev + 1)
      
      // Remove entries that have finished fading in (after fade-out delay + fade-in duration)
      setNewlyAddedTxs(prev => {
        const updated = new Map(prev)
        prev.forEach(({ addedAt }, txId) => {
          const totalDuration = FADE_OUT_DURATION + FADE_IN_DURATION
          if (now - addedAt >= totalDuration) {
            updated.delete(txId)
          }
        })
        return updated
      })
    }, 10) // Update every 10ms for smooth fade animation (100fps)

    return () => clearInterval(interval)
  }, [newlyAddedTxs])

  // Trigger immediate reload when reloadTrigger changes (for coordination with In Progress)
  useEffect(() => {
    if (reloadTrigger !== undefined && reloadTrigger > 0) {
      loadTransactions()
    }
  }, [reloadTrigger, loadTransactions])

  const handleDelete = useCallback(
    (txId: string) => {
      try {
        deleteTransaction(txId)
        // Remove from newly added if present
        setNewlyAddedTxs(prev => {
          const updated = new Map(prev)
          updated.delete(txId)
          return updated
        })
        // Refresh the list after deletion
        loadTransactions()
      } catch (err) {
        console.error('[TxHistoryList] Failed to delete transaction', err)
      }
    },
    [deleteTransaction, loadTransactions],
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Spinner label="Loading history..." />
      </div>
    )
  }

  if (error) {
    return (
      <div className="card card-error card-sm rounded-md text-sm text-error">
        <p className="font-medium">Error loading history</p>
        <p className="mt-1 text-xs">{error}</p>
      </div>
    )
  }

  if (completedTxs.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        History will appear after your first transaction.
      </div>
    )
  }

  return (
    <div className="space-y-0">
      {completedTxs.map((tx, index) => {
        const isNewlyAdded = newlyAddedTxs.has(tx.id)
        const { addedAt } = newlyAddedTxs.get(tx.id) || { addedAt: 0 }
        const now = Date.now()
        const elapsed = now - addedAt
        
        // Calculate opacity: wait for fade-out duration, then fade in over FADE_IN_DURATION
        let opacity = 1
        if (isNewlyAdded) {
          if (elapsed < FADE_OUT_DURATION) {
            // Still waiting for fade-out to complete, keep invisible
            opacity = 0
          } else {
            // Fade-out complete, start fading in
            const fadeInElapsed = elapsed - FADE_OUT_DURATION
            opacity = Math.min(1, fadeInElapsed / FADE_IN_DURATION)
          }
        }

        return (
          <div
            key={tx.id}
            className={cn(
              isNewlyAdded && 'transition-opacity duration-500 ease-out'
            )}
            style={isNewlyAdded ? { opacity, transition: 'opacity 500ms ease-out' } : undefined}
          >
            <TransactionCard
              transaction={tx}
              variant="compact"
              showExpandButton={true}
              onDelete={handleDelete}
              hideActions={hideActions}
              isModalOpen={openModalTxId === tx.id}
              onModalOpenChange={(open) => {
                if (onModalOpenChange) {
                  onModalOpenChange(open ? tx.id : null)
                }
              }}
            />
            {/* Add divider between items, but not after the last one */}
            {index < completedTxs.length - 1 && (
              <div className="border-b border-border/60 my-2" />
            )}
          </div>
        )
      })}
    </div>
  )
}
