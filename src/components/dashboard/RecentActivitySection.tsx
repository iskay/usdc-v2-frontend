import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/common/Button'
import { TxInProgressList } from '@/components/tx/TxInProgressList'
import { TxHistoryList } from '@/components/tx/TxHistoryList'
import { TransactionDetailModal } from '@/components/tx/TransactionDetailModal'
import { transactionStorageService, type StoredTransaction } from '@/services/tx/transactionStorageService'

export interface RecentActivitySectionProps {
  /** Currently open modal transaction ID */
  openModalTxId: string | null
  /** Callback when modal open state changes */
  onModalOpenChange: (txId: string | null) => void
  /** Reload trigger for history list */
  reloadTrigger?: number
}

/**
 * Recent activity section component
 * 
 * Displays in-progress and history transaction lists with section headers.
 */
export function RecentActivitySection({
  openModalTxId,
  onModalOpenChange,
  reloadTrigger,
}: RecentActivitySectionProps) {
  const [modalTransaction, setModalTransaction] = useState<StoredTransaction | null>(null)

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

  return (
    <>
      <div className="flex-5 card">
        {/* Section Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-md font-semibold">Recent activity</h2>
          <Link to="/history">
            <Button variant="ghost" className="h-6 px-2 text-xs">
              View All
            </Button>
          </Link>
        </div>

        {/* In Progress Section */}
        <div className="mb-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            In Progress
          </h2>
          <TxInProgressList
            openModalTxId={openModalTxId}
            onModalOpenChange={onModalOpenChange}
            hideActions={true}
          />
        </div>

        {/* History Section */}
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            History
          </h2>
          <TxHistoryList
            openModalTxId={openModalTxId}
            onModalOpenChange={onModalOpenChange}
            reloadTrigger={reloadTrigger}
            hideActions={true}
          />
        </div>
      </div>

      {/* Render modal at this level so it persists during list transitions */}
      {modalTransaction && (
        <TransactionDetailModal
          transaction={modalTransaction}
          open={!!openModalTxId}
          onClose={() => onModalOpenChange(null)}
        />
      )}
    </>
  )
}
