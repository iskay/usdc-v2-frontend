import { useEffect, useState } from 'react'
import { transactionStorageService, type StoredTransaction } from '@/services/tx/transactionStorageService'
import { TransactionCard } from './TransactionCard'
import { isInProgress } from '@/services/tx/transactionStatusService'

export function TxInProgressList() {
  const [inProgressTxs, setInProgressTxs] = useState<StoredTransaction[]>([])

  // Load in-progress transactions from unified storage
  useEffect(() => {
    const loadTransactions = () => {
      const txs = transactionStorageService.getInProgressTransactions()
      setInProgressTxs(txs)
    }

    // Load initially
    loadTransactions()

    // Reload periodically to catch updates
    const interval = setInterval(loadTransactions, 2000)
    return () => clearInterval(interval)
  }, [])

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
          />
        )
      })}
    </div>
  )
}
