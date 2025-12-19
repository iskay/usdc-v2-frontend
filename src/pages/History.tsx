import { useState, useEffect, useCallback, startTransition } from 'react'
import { AlertTriangle, Download } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { Tooltip } from '@/components/common/Tooltip'
import { TransactionCard } from '@/components/tx/TransactionCard'
import { TransactionDetailModal } from '@/components/tx/TransactionDetailModal'
import { Spinner } from '@/components/common/Spinner'
import { transactionStorageService, type StoredTransaction } from '@/services/tx/transactionStorageService'
import { useDeleteTransaction } from '@/hooks/useDeleteTransaction'
import { isInProgress } from '@/services/tx/transactionStatusService'

const FILTERS = ['all', 'deposits', 'payments'] as const

export function History() {
  const [activeFilter, setActiveFilter] = useState<(typeof FILTERS)[number]>('all')
  const [allTransactions, setAllTransactions] = useState<StoredTransaction[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { deleteTransaction } = useDeleteTransaction()
  const [openModalTxId, setOpenModalTxId] = useState<string | null>(null)
  const [modalTransaction, setModalTransaction] = useState<StoredTransaction | null>(null)

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

  // Fetch transaction directly from storage when modal should be open
  // This ensures the modal persists even when transaction moves between lists during animation
  useEffect(() => {
    if (openModalTxId) {
      // Fetch transaction directly from storage (not from list)
      const tx = transactionStorageService.getTransaction(openModalTxId)
      setModalTransaction(tx || null)
    } else {
      setModalTransaction(null)
    }
  }, [openModalTxId])

  // Also update transaction when it changes in storage (e.g., status updates)
  useEffect(() => {
    if (!openModalTxId) return

    const checkTransaction = () => {
      const tx = transactionStorageService.getTransaction(openModalTxId)
      if (tx) {
        setModalTransaction(tx)
      }
    }

    // Check immediately
    checkTransaction()

    // Check periodically to catch status updates
    const interval = setInterval(checkTransaction, 1000)
    return () => clearInterval(interval)
  }, [openModalTxId])

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

  // Memoize the modal change handler to prevent unnecessary re-renders
  // Use startTransition to defer state update and avoid blocking the click handler
  const handleModalOpenChange = useCallback((txId: string | null) => {
    startTransition(() => {
      setOpenModalTxId(txId)
    })
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
    <div className="container space-y-6 p-12 mx-auto w-full">
      {/* <div className="mb-8">
        <BreadcrumbNav />
      </div> */}

      <header className="space-y-2">
        <p className="text-muted-foreground">
          Review your recent transaction activity
        </p>
      </header>

      {/* Filters Section */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((filter) => (
            <Button
              key={filter}
              variant={activeFilter === filter ? 'primary' : 'ghost'}
              onClick={() => setActiveFilter(filter)}
              className="transition-all rounded-xl"
            >
              {filter === 'all' ? 'All Activity' : filter === 'deposits' ? 'Deposits' : 'Payments'}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex">
          <Tooltip
            content="History is only available on this device. Browser storage can be volatile so this page serves as a reference only; assume any info here can be lost unless backed up independently."
            side="top"
            className="whitespace-normal max-w-md"
          >
            <div className="flex gap-2">
            <AlertTriangle className="h-5 w-5 text-warning flex-shrink-0" />
            <span className="text-sm font-semibold text-warning">Important</span>
            </div>
          </Tooltip>
          </div>
          <Tooltip
            content="TODO: Add CSV export functionality for transaction history."
            side="top"
            className="whitespace-normal max-w-xs"
          >
            <Button variant="ghost" className="ml-auto rounded-xl" disabled>
              <Download className="h-4 w-4" />
              Export History
            </Button>
          </Tooltip>
        </div>
      </div>

      {/* Transaction List */}
      {isLoading ? (
        <div className="card card-3xl">
          <div className="flex items-center justify-center">
            <Spinner label="Loading transaction history..." />
          </div>
        </div>
      ) : error ? (
        <div className="card card-error card-2xl text-center">
          <p className="text-base font-semibold text-error">Error loading transactions</p>
          <p className="mt-2 text-sm text-error/90">{error}</p>
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
        <div className="card card-3xl text-center">
          <p className="text-base text-muted-foreground">
            {activeFilter === 'all'
              ? 'No transactions found. Your transaction history will appear here.'
              : activeFilter === 'deposits'
                ? 'No deposits found.'
                : 'No payments found.'}
          </p>
        </div>
      ) : (
        <div className="card card-xl">
          {/* Column Headers */}
          <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-4 pb-4 mb-4 border-b border-border">
            <div className="text-sm font-semibold text-muted-foreground">Transaction<span className="text-xs font-normal ml-1">(click for details)</span></div>
            <div className="text-sm font-semibold text-muted-foreground">Amount & Status</div>
            <div></div>
            <div className="text-sm font-semibold text-muted-foreground">Actions</div>
          </div>

          <div className="space-y-0">
            {filteredTransactions.map((tx, index) => {
              const isCompleted = !isInProgress(tx)
              const nextTx = filteredTransactions[index + 1]
              const nextIsCompleted = nextTx ? !isInProgress(nextTx) : false
              const showDivider = isCompleted && nextIsCompleted && index < filteredTransactions.length - 1

              return (
                <div key={tx.id} className='mb-4'>
                  <TransactionCard
                    transaction={tx}
                    variant="detailed"
                    showExpandButton={true}
                    onDelete={handleDelete}
                    isModalOpen={openModalTxId === tx.id}
                    onModalOpenChange={(open) => {
                      handleModalOpenChange(open ? tx.id : null)
                    }}
                  />
                  {/* Add divider between completed items */}
                  {showDivider && (
                    <div className="border-b border-border/60 my-2" />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
      <div className='min-h-12' />

      {/* Render modal at page level so it persists during list transitions */}
      {modalTransaction && (
        <TransactionDetailModal
          transaction={modalTransaction}
          open={!!openModalTxId}
          onClose={() => handleModalOpenChange(null)}
        />
      )}
    </div>
  )
}
