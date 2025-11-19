import { useEffect, useState, useCallback } from 'react'
import { transactionStorageService, type StoredTransaction } from '@/services/tx/transactionStorageService'
import { TransactionCard } from './TransactionCard'
import { Spinner } from '@/components/common/Spinner'
import { useDeleteTransaction } from '@/hooks/useDeleteTransaction'

export interface TxHistoryListProps {
  openModalTxId?: string | null
  onModalOpenChange?: (txId: string | null) => void
  reloadTrigger?: number // When changed, triggers immediate reload
}

export function TxHistoryList({ openModalTxId, onModalOpenChange, reloadTrigger }: TxHistoryListProps = {}) {
  const [completedTxs, setCompletedTxs] = useState<StoredTransaction[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { deleteTransaction } = useDeleteTransaction()

  const loadTransactions = useCallback(() => {
    try {
      const txs = transactionStorageService.getCompletedTransactions(5)
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
      <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
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
    <div className="space-y-2">
      {completedTxs.map((tx) => (
        <TransactionCard
          key={tx.id}
          transaction={tx}
          variant="compact"
          showExpandButton={true}
          onDelete={handleDelete}
          isModalOpen={openModalTxId === tx.id}
          onModalOpenChange={(open) => {
            if (onModalOpenChange) {
              onModalOpenChange(open ? tx.id : null)
            }
          }}
        />
      ))}
    </div>
  )
}
