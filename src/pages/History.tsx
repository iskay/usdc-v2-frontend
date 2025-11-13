import { useState, useEffect } from 'react'
import { AlertBox } from '@/components/common/AlertBox'
import { Button } from '@/components/common/Button'
import { TransactionCard } from '@/components/tx/TransactionCard'
import { transactionStorageService, type StoredTransaction } from '@/services/tx/transactionStorageService'

const FILTERS = ['all', 'deposits', 'payments'] as const

export function History() {
  const [activeFilter, setActiveFilter] = useState<(typeof FILTERS)[number]>('all')
  const [allTransactions, setAllTransactions] = useState<StoredTransaction[]>([])

  // Load all transactions from unified storage (both in-progress and completed)
  useEffect(() => {
    const loadTransactions = () => {
      const allTxs = transactionStorageService.getAllTransactions()
      setAllTransactions(allTxs)
    }

    // Load initially
    loadTransactions()

    // Reload periodically to catch updates
    const interval = setInterval(loadTransactions, 2000)
    return () => clearInterval(interval)
  }, [])

  // Filter transactions based on active filter
  const filteredTransactions = allTransactions.filter((tx) => {
    if (activeFilter === 'all') {
      return true
    }
    if (activeFilter === 'deposits') {
      return tx.direction === 'deposit'
    }
    if (activeFilter === 'payments') {
      return tx.direction === 'send'
    }
    return true
  })

  return (
    <div className="space-y-6 p-24">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Transaction History</h1>
        <p className="text-muted-foreground">
          Review deposits, payments, and transaction activity across your connected accounts.
        </p>
      </header>
      <AlertBox tone="info" title="Export roadmap">
        TODO: Add CSV export functionality for transaction history.
      </AlertBox>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((filter) => (
          <Button
            key={filter}
            variant={activeFilter === filter ? 'primary' : 'ghost'}
            onClick={() => setActiveFilter(filter)}
          >
            {filter === 'all' ? 'All Activity' : filter === 'deposits' ? 'Deposits' : 'Payments'}
          </Button>
        ))}
        <Button variant="ghost" className="ml-auto" disabled>
          Export History
        </Button>
      </div>

      {/* Transaction List */}
      {filteredTransactions.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {activeFilter === 'all'
              ? 'No transactions found. Your transaction history will appear here.'
              : activeFilter === 'deposits'
                ? 'No deposits found.'
                : 'No payments found.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredTransactions.map((tx) => (
            <TransactionCard
              key={tx.id}
              transaction={tx}
              variant="detailed"
              showExpandButton={true}
            />
          ))}
        </div>
      )}
    </div>
  )
}
