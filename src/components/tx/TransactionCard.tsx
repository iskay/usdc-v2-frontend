import { useState, memo } from 'react'
import { Clock, CheckCircle2, XCircle, AlertCircle, ChevronRight } from 'lucide-react'
import type { StoredTransaction } from '@/services/tx/transactionStorageService'
import {
  isInProgress,
  isSuccess,
  isError,
  getStatusLabel,
  getTimeElapsed,
  getProgressPercentage,
} from '@/services/tx/transactionStatusService'
import { TransactionDetailModal } from './TransactionDetailModal'
import { cn } from '@/lib/utils'

export interface TransactionCardProps {
  transaction: StoredTransaction
  variant?: 'compact' | 'detailed'
  onClick?: () => void
  showExpandButton?: boolean
}

export const TransactionCard = memo(function TransactionCard({
  transaction,
  variant = 'compact',
  onClick,
  showExpandButton = true,
}: TransactionCardProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)

  const handleClick = () => {
    if (onClick) {
      onClick()
    } else if (showExpandButton) {
      setIsModalOpen(true)
    }
  }

  const flowType = transaction.direction === 'deposit' ? 'deposit' : 'payment'
  const statusLabel = getStatusLabel(transaction)
  const timeElapsed = getTimeElapsed(transaction)
  const progress = getProgressPercentage(transaction, flowType)

  // Get amount from transaction metadata
  let amount: string | undefined
  if (transaction.flowMetadata) {
    const amountInBase = transaction.flowMetadata.amount
    if (amountInBase) {
      const amountInUsdc = (parseInt(amountInBase) / 1_000_000).toFixed(2)
      amount = `$${amountInUsdc}`
    }
  } else if (transaction.depositDetails) {
    amount = `$${transaction.depositDetails.amount}`
  } else if (transaction.paymentDetails) {
    amount = `$${transaction.paymentDetails.amount}`
  }

  // Status icon and color
  let statusIcon = <Clock className="h-4 w-4" />
  let statusColor = 'text-muted-foreground'

  if (isSuccess(transaction)) {
    statusIcon = <CheckCircle2 className="h-4 w-4" />
    statusColor = 'text-green-600'
  } else if (isError(transaction)) {
    statusIcon = <XCircle className="h-4 w-4" />
    statusColor = 'text-red-600'
  } else if (transaction.status === 'undetermined' || transaction.isFrontendOnly) {
    statusIcon = <AlertCircle className="h-4 w-4" />
    statusColor = 'text-yellow-600'
  }

  return (
    <>
      <div
        className={cn(
          'rounded-lg border border-border bg-card p-4 shadow-sm transition-all hover:shadow-md',
          onClick || showExpandButton ? 'cursor-pointer' : '',
        )}
        onClick={handleClick}
      >
        <div className="flex items-start justify-between gap-4">
          {/* Left side: Transaction info */}
          <div className="flex-1 space-y-2">
            {/* Header: Type and Amount */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium capitalize">
                {transaction.direction === 'deposit' ? 'Deposit' : 'Payment'}
              </span>
              {amount && <span className="text-sm text-muted-foreground">{amount}</span>}
            </div>

            {/* Status and Time */}
            <div className="flex items-center gap-3 text-xs">
              <div className={cn('flex items-center gap-1.5', statusColor)}>
                {statusIcon}
                <span>{statusLabel}</span>
              </div>
              {transaction.isFrontendOnly && (
                <span className="text-xs text-yellow-600">(Frontend Only)</span>
              )}
              <span className="text-muted-foreground">{timeElapsed}</span>
            </div>

            {/* Progress bar (for in-progress transactions) */}
            {isInProgress(transaction) && variant === 'detailed' && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Progress</span>
                  <span className="font-medium">{progress}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Chain info */}
            {variant === 'detailed' && (
              <div className="text-xs text-muted-foreground">
                Chain: {transaction.chain}
              </div>
            )}
          </div>

          {/* Right side: Expand button */}
          {showExpandButton && (onClick || showExpandButton) && (
            <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
          )}
        </div>
      </div>

      {/* Detail Modal */}
      {showExpandButton && (
        <TransactionDetailModal
          transaction={transaction}
          open={isModalOpen}
          onClose={() => setIsModalOpen(false)}
        />
      )}
    </>
  )
})

