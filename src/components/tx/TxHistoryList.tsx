import { useEffect, useState } from 'react'
import { transactionStorageService, type StoredTransaction } from '@/services/tx/transactionStorageService'
import { TransactionCard } from './TransactionCard'
import { Spinner } from '@/components/common/Spinner'

export function TxHistoryList() {
  const [completedTxs, setCompletedTxs] = useState<StoredTransaction[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load completed transactions from unified storage (limit to 5 most recent)
  useEffect(() => {
    const loadTransactions = () => {
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
    }

    // Load initially
    loadTransactions()

    // Reload periodically to catch updates (optimized: 10 seconds for completed transactions)
    const interval = setInterval(loadTransactions, 10000)
    return () => clearInterval(interval)
  }, [])

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
        />
      ))}
    </div>
  )
}
