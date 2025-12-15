import { useEffect, useState, useCallback, useRef } from 'react'
import { transactionStorageService, type StoredTransaction } from '@/services/tx/transactionStorageService'
import { TransactionCard } from './TransactionCard'
import { isInProgress } from '@/services/tx/transactionStatusService'
import { Spinner } from '@/components/common/Spinner'
import { useDeleteTransaction } from '@/hooks/useDeleteTransaction'
import { cn } from '@/lib/utils'

export interface TxInProgressListProps {
  openModalTxId?: string | null
  onModalOpenChange?: (txId: string | null) => void
  hideActions?: boolean // Hide the actions column (dropdown menu)
}

// Delay before removing completed transactions (in milliseconds)
const COMPLETION_DISPLAY_DURATION = 500 // 500ms

export function TxInProgressList({ openModalTxId, onModalOpenChange, hideActions = false }: TxInProgressListProps = {}) {
  const [inProgressTxs, setInProgressTxs] = useState<StoredTransaction[]>([])
  const [recentlyCompletedTxs, setRecentlyCompletedTxs] = useState<Map<string, { tx: StoredTransaction; completedAt: number }>>(new Map())
  const [_fadeTick, setFadeTick] = useState(0) // Force re-render for fade animation
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { deleteTransaction } = useDeleteTransaction()
  const previousTxIdsRef = useRef<Set<string>>(new Set())

  const loadTransactions = useCallback(() => {
    try {
      const txs = transactionStorageService.getInProgressTransactions()
      const currentTxIds = new Set(txs.map(tx => tx.id))
      
      // Find transactions that disappeared from in-progress list
      const disappearedIds = Array.from(previousTxIdsRef.current).filter(
        id => !currentTxIds.has(id)
      )
      
      // Check if they're completed (not just deleted)
      if (disappearedIds.length > 0) {
        const allTxs = transactionStorageService.getAllTransactions()
        disappearedIds.forEach(id => {
          const tx = allTxs.find(t => t.id === id)
          if (tx && !isInProgress(tx)) {
            // Transaction completed, add to recently completed
            setRecentlyCompletedTxs(prev => {
              const updated = new Map(prev)
              // Only add if not already tracking it
              if (!updated.has(id)) {
                updated.set(id, { tx, completedAt: Date.now() })
              }
              return updated
            })
          }
        })
      }
      
      // Update previous IDs for next comparison
      previousTxIdsRef.current = currentTxIds
      
      setInProgressTxs(txs)
      setIsLoading(false)
      setError(null)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load transactions'
      console.error('[TxInProgressList] Failed to load transactions', err)
      setError(errorMessage)
      setIsLoading(false)
    }
  }, [])

  // Remove recently completed transactions after delay and trigger fade animation
  useEffect(() => {
    if (recentlyCompletedTxs.size === 0) return

    // Set up interval to update fade animation and check for expired transactions
    const interval = setInterval(() => {
      const now = Date.now()
      const expired: string[] = []
      
      // Update fade tick to trigger re-render for smooth opacity transition
      setFadeTick(prev => prev + 1)
      
      recentlyCompletedTxs.forEach(({ completedAt }, txId) => {
        if (now - completedAt >= COMPLETION_DISPLAY_DURATION) {
          expired.push(txId)
        }
      })

      if (expired.length > 0) {
        setRecentlyCompletedTxs(prev => {
          const updated = new Map(prev)
          expired.forEach(id => updated.delete(id))
          return updated
        })
      }
    }, 10) // Update every 10ms for smooth fade animation (100fps)

    return () => clearInterval(interval)
  }, [recentlyCompletedTxs])

  // Load in-progress transactions from unified storage
  useEffect(() => {
    // Load initially
    loadTransactions()

    // Reload periodically to catch updates (optimized: 5 seconds for in-progress)
    const interval = setInterval(loadTransactions, 5000)
    return () => clearInterval(interval)
  }, [loadTransactions])

  const handleDelete = useCallback(
    (txId: string) => {
      try {
        deleteTransaction(txId)
        // Remove from recently completed if present
        setRecentlyCompletedTxs(prev => {
          const updated = new Map(prev)
          updated.delete(txId)
          return updated
        })
        // Refresh the list after deletion
        loadTransactions()
      } catch (err) {
        console.error('[TxInProgressList] Failed to delete transaction', err)
      }
    },
    [deleteTransaction, loadTransactions],
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Spinner label="Loading transactions..." />
      </div>
    )
  }

  if (error) {
    return (
      <div className="card card-error card-sm rounded-md text-sm text-error">
        <p className="font-medium">Error loading transactions</p>
        <p className="mt-1 text-xs">{error}</p>
      </div>
    )
  }

  // Combine in-progress and recently completed transactions
  const allDisplayTxs = [
    ...inProgressTxs,
    ...Array.from(recentlyCompletedTxs.values()).map(({ tx }) => tx)
  ]

  if (allDisplayTxs.length === 0) {
    return (
      <div className="text-sm text-muted-foreground min-h-20">
        No transactions in progress.
      </div>
    )
  }

  return (
    <div className="space-y-2 min-h-20">
      {allDisplayTxs.map((tx) => {
        const isRecentlyCompleted = recentlyCompletedTxs.has(tx.id)
        const { completedAt } = recentlyCompletedTxs.get(tx.id) || { completedAt: 0 }
        const elapsed = Date.now() - completedAt
        const opacity = isRecentlyCompleted 
          ? Math.max(0, 1 - (elapsed / COMPLETION_DISPLAY_DURATION))
          : 1

        return (
          <div
            key={tx.id}
            className={cn(
              isRecentlyCompleted && 'transition-opacity duration-500 ease-out',
              isRecentlyCompleted && opacity < 0.01 && 'hidden'
            )}
            style={isRecentlyCompleted ? { opacity, transition: 'opacity 500ms ease-out' } : undefined}
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
          </div>
        )
      })}
    </div>
  )
}
