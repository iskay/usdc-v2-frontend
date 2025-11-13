import { useEffect, useState } from 'react'
import { transactionStorageService, type StoredTransaction } from '@/services/tx/transactionStorageService'
import { TransactionCard } from './TransactionCard'

export function TxHistoryList() {
  const [completedTxs, setCompletedTxs] = useState<StoredTransaction[]>([])

  // Load completed transactions from unified storage (limit to 5 most recent)
  useEffect(() => {
    const loadTransactions = () => {
      const txs = transactionStorageService.getCompletedTransactions(5)
      setCompletedTxs(txs)
    }

    // Load initially
    loadTransactions()

    // Reload periodically to catch updates
    const interval = setInterval(loadTransactions, 2000)
    return () => clearInterval(interval)
  }, [])

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
