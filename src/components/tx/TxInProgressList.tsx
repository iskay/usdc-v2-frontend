import { useEffect, useState, useCallback } from 'react'
import { transactionStorageService, type StoredTransaction } from '@/services/tx/transactionStorageService'
import { TransactionCard } from './TransactionCard'
import { isInProgress } from '@/services/tx/transactionStatusService'
import { Spinner } from '@/components/common/Spinner'
import { useDeleteTransaction } from '@/hooks/useDeleteTransaction'

export interface TxInProgressListProps {
  openModalTxId?: string | null
  onModalOpenChange?: (txId: string | null) => void
}

export function TxInProgressList({ openModalTxId, onModalOpenChange }: TxInProgressListProps = {}) {
  const [inProgressTxs, setInProgressTxs] = useState<StoredTransaction[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { deleteTransaction } = useDeleteTransaction()

  const loadTransactions = useCallback(() => {
    try {
      const txs = transactionStorageService.getInProgressTransactions()
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
      <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
        <p className="font-medium">Error loading transactions</p>
        <p className="mt-1 text-xs">{error}</p>
      </div>
    )
  }

  if (inProgressTxs.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No transactions in progress.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {inProgressTxs.map((tx) => {
        // Double-check transaction is still in progress (defensive)
        if (!isInProgress(tx)) {
          return null
        }

        return (
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
        )
      })}
    </div>
  )
}
