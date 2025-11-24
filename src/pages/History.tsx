import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { AlertBox } from '@/components/common/AlertBox'
import { Button } from '@/components/common/Button'
import { BackToHome } from '@/components/common/BackToHome'
import { TransactionCard } from '@/components/tx/TransactionCard'
import { Spinner } from '@/components/common/Spinner'
import { transactionStorageService, type StoredTransaction } from '@/services/tx/transactionStorageService'
import { useDeleteTransaction } from '@/hooks/useDeleteTransaction'

const FILTERS = ['all', 'deposits', 'payments'] as const

export function History() {
  const [activeFilter, setActiveFilter] = useState<(typeof FILTERS)[number]>('all')
  const [allTransactions, setAllTransactions] = useState<StoredTransaction[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { deleteTransaction } = useDeleteTransaction()
  const [openModalTxId, setOpenModalTxId] = useState<string | null>(null)

  const loadTransactions = useCallback(() => {
    try {
      const allTxs = transactionStorageService.getAllTransactions()
      setAllTransactions(allTxs)
      setIsLoading(false)
      setError(null)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load transactions'
      console.error('[History] Failed to load transactions', err)
      setError(errorMessage)
      setIsLoading(false)
    }
  }, [])

  // Load all transactions from unified storage (both in-progress and completed)
  useEffect(() => {
    // Load initially
    loadTransactions()

    // Reload periodically to catch updates (optimized: 5 seconds for history page)
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
        console.error('[History] Failed to delete transaction', err)
      }
    },
    [deleteTransaction, loadTransactions],
  )

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
    <div className="space-y-6 p-24 max-w-[1024px] mx-auto w-full">
      <BackToHome />

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Transaction History</h1>
        <p className="text-muted-foreground">
          Review deposits, payments, and transaction activity across your connected accounts.
        </p>
      </header>

      {/* Filters Section */}
      <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((filter) => (
              <Button
                key={filter}
                variant={activeFilter === filter ? 'primary' : 'ghost'}
                onClick={() => setActiveFilter(filter)}
                className="transition-all"
              >
                {filter === 'all' ? 'All Activity' : filter === 'deposits' ? 'Deposits' : 'Payments'}
              </Button>
            ))}
          </div>
          <Button variant="ghost" className="ml-auto" disabled>
            Export History
          </Button>
        </div>
      </div>

      {/* Alert Box */}
      <AlertBox tone="info" title="Export roadmap">
        TODO: Add CSV export functionality for transaction history.
      </AlertBox>

      {/* Transaction List */}
      {isLoading ? (
        <div className="rounded-lg border border-border bg-card p-12 shadow-sm">
          <div className="flex items-center justify-center">
            <Spinner label="Loading transaction history..." />
          </div>
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-200/50 bg-red-50/50 dark:bg-red-950/20 dark:border-red-800/50 p-8 text-center shadow-sm">
          <p className="text-base font-semibold text-red-900 dark:text-red-100">Error loading transactions</p>
          <p className="mt-2 text-sm text-red-800 dark:text-red-200">{error}</p>
          <Button
            variant="secondary"
            className="mt-4"
            onClick={() => {
              setError(null)
              setIsLoading(true)
              const allTxs = transactionStorageService.getAllTransactions()
              setAllTransactions(allTxs)
              setIsLoading(false)
            }}
          >
            Retry
          </Button>
        </div>
      ) : filteredTransactions.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-12 text-center shadow-sm">
          <p className="text-base text-muted-foreground">
            {activeFilter === 'all'
              ? 'No transactions found. Your transaction history will appear here.'
              : activeFilter === 'deposits'
                ? 'No deposits found.'
                : 'No payments found.'}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
          <div className="space-y-3">
            {filteredTransactions.map((tx) => (
              <TransactionCard
                key={tx.id}
                transaction={tx}
                variant="detailed"
                showExpandButton={true}
                onDelete={handleDelete}
                isModalOpen={openModalTxId === tx.id}
                onModalOpenChange={(open) => {
                  setOpenModalTxId(open ? tx.id : null)
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
