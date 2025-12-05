import { useState, memo, cloneElement } from 'react'
import { Clock, CheckCircle2, XCircle, AlertCircle, Trash2, ArrowDown, Send, MoreVertical } from 'lucide-react'
import type { StoredTransaction } from '@/services/tx/transactionStorageService'
import {
  isInProgress,
  isSuccess,
  isError,
  getStatusLabel,
  getTimeElapsed,
  getProgressPercentage,
  getEffectiveStatus,
  hasClientTimeout,
  getTimeoutMessage,
} from '@/services/tx/transactionStatusService'
import { TransactionDetailModal } from './TransactionDetailModal'
import { DeleteTransactionConfirmationDialog } from './DeleteTransactionConfirmationDialog'
import { DropdownMenu, DropdownMenuItem } from '@/components/common/DropdownMenu'
import { cn } from '@/lib/utils'

export interface TransactionCardProps {
  transaction: StoredTransaction
  variant?: 'compact' | 'detailed'
  onClick?: () => void
  showExpandButton?: boolean
  onDelete?: (txId: string) => void
  hideActions?: boolean // Hide the actions column (dropdown menu)
  // Optional external modal state control (for persistence across component remounts)
  isModalOpen?: boolean
  onModalOpenChange?: (open: boolean) => void
}

export const TransactionCard = memo(function TransactionCard({
  transaction,
  variant = 'compact',
  onClick,
  showExpandButton = true,
  onDelete,
  hideActions = false,
  isModalOpen: externalIsModalOpen,
  onModalOpenChange,
}: TransactionCardProps) {
  // Use external modal state if provided, otherwise use internal state
  const [internalIsModalOpen, setInternalIsModalOpen] = useState(false)
  const isModalOpen = externalIsModalOpen !== undefined ? externalIsModalOpen : internalIsModalOpen
  const setIsModalOpen = onModalOpenChange || setInternalIsModalOpen
  
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)

  const handleClick = () => {
    if (onClick) {
      onClick()
    } else if (showExpandButton) {
      setIsModalOpen(true)
    }
  }

  const handleDeleteConfirm = () => {
    if (onDelete) {
      onDelete(transaction.id)
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

  // Status icon, color, and badge styling
  let statusIcon = <Clock className="h-3.5 w-3.5" />
  let badgeBgColor = 'bg-muted'
  let badgeTextColor = 'text-muted-foreground'
  let badgeBorderColor = 'border-muted'

  const effectiveStatus = getEffectiveStatus(transaction)
  const inProgress = isInProgress(transaction)
  
  if (isSuccess(transaction)) {
    statusIcon = <CheckCircle2 className="h-3.5 w-3.5" />
    badgeBgColor = 'bg-green-100 dark:bg-green-900/30'
    badgeTextColor = 'text-green-700 dark:text-green-400'
    badgeBorderColor = 'border-green-200 dark:border-green-800'
  } else if (isError(transaction)) {
    statusIcon = <XCircle className="h-3.5 w-3.5" />
    badgeBgColor = 'bg-red-100 dark:bg-red-900/30'
    badgeTextColor = 'text-red-700 dark:text-red-400'
    badgeBorderColor = 'border-red-200 dark:border-red-800'
  } else if (effectiveStatus === 'user_action_required') {
    statusIcon = <AlertCircle className="h-3.5 w-3.5" />
    badgeBgColor = 'bg-orange-100 dark:bg-orange-900/30'
    badgeTextColor = 'text-orange-700 dark:text-orange-400'
    badgeBorderColor = 'border-orange-200 dark:border-orange-800'
  } else if (effectiveStatus === 'undetermined') {
    statusIcon = <AlertCircle className="h-3.5 w-3.5" />
    badgeBgColor = 'bg-yellow-100 dark:bg-yellow-900/30'
    badgeTextColor = 'text-yellow-700 dark:text-yellow-400'
    badgeBorderColor = 'border-yellow-200 dark:border-yellow-800'
  } else if (inProgress) {
    // In progress/broadcasted
    badgeBgColor = 'bg-muted'
    badgeTextColor = 'text-muted-foreground'
    badgeBorderColor = 'border-muted'
  }

  return (
    <>
      <div
        className={cn(
          'bg-card transition-all',
          // Conditional border, shadow, and padding: only for in-progress transactions
          inProgress 
            ? 'rounded-lg border border-border shadow-sm hover:shadow-md p-4 bg-blue-200/20' 
            : variant === 'compact' 
              ? 'p-3' 
              : 'rounded-lg border-0 shadow-none p-4',
          onClick || showExpandButton ? 'cursor-pointer' : '',
        )}
        onClick={handleClick}
      >
        {/* Dashboard compact layout (when hideActions is true and variant is compact) */}
        {hideActions && variant === 'compact' ? (
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            {/* Column 1: Transaction - Type and source chain */}
            <div className="flex items-center gap-2 min-w-0">
              {/* Transaction type icon - smaller for dashboard */}
              <div className="flex-shrink-0">
                {transaction.direction === 'deposit' ? (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-yellow-100 dark:bg-yellow-900/30">
                    <ArrowDown className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
                  </div>
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
                    <Send className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  </div>
                )}
              </div>
              
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-medium capitalize truncate">
                  {transaction.direction === 'deposit' ? 'Deposit' : 'Payment'}
                </span>
                <span className="text-xs text-muted-foreground truncate">
                  {transaction.direction === 'deposit' 
                    ? `From: ${transaction.chain}`
                    : `To: ${transaction.paymentDetails?.chainName || transaction.chain}`
                  }
                </span>
              </div>
            </div>

            {/* Column 2: Amount only */}
            <div className="flex items-center justify-end min-w-0">
              {amount && (
                <span className="text-sm font-medium">{amount}</span>
              )}
            </div>

            {/* Column 3: Status and time - stacked vertically */}
            <div className="flex flex-col items-end gap-1 min-w-0">
              {/* Status badge */}
              <div className="flex items-center gap-1.5">
                <div className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5',
                  badgeBgColor,
                  badgeTextColor,
                  badgeBorderColor
                )}>
                  {cloneElement(statusIcon, { className: 'h-3 w-3' })}
                  <span className="text-[10px] font-medium leading-tight">{statusLabel}</span>
                </div>
                
                {hasClientTimeout(transaction) && (
                  <div className="group relative">
                    <AlertCircle className="h-3 w-3 text-yellow-600" />
                    <div className="absolute bottom-full left-1/2 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 shadow-lg transition-opacity group-hover:block group-hover:opacity-100">
                      {getTimeoutMessage(transaction)}
                    </div>
                  </div>
                )}
              </div>
              
              {/* Time with clock icon - smaller */}
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span>{timeElapsed}</span>
              </div>
            </div>
          </div>
        ) : (
        <div className={cn(
            'grid items-center',
            hideActions ? 'grid-cols-[1fr_1fr]' : 'grid-cols-[1fr_1fr_auto]',
          variant === 'compact' ? 'gap-3' : 'gap-4'
        )}>
            {/* Column 1: Transaction - Type and source chain */}
            <div className="flex items-center gap-3 min-w-0">
              {/* Transaction type icon */}
              <div className="flex-shrink-0">
                {transaction.direction === 'deposit' ? (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-100 dark:bg-yellow-900/30">
                    <ArrowDown className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
                  </div>
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
                    <Send className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                )}
              </div>
              
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-medium capitalize truncate">
                  {transaction.direction === 'deposit' ? 'Deposit' : 'Payment'}
                </span>
                <span className="text-xs text-muted-foreground truncate">
                  {transaction.direction === 'deposit' 
                    ? `From: ${transaction.chain}`
                    : `To: ${transaction.paymentDetails?.chainName || transaction.chain}`
                  }
                </span>
              </div>
            </div>

            {/* Column 2: Amount & Status - Amount, status and time */}
            <div className="flex flex-col gap-2 min-w-0">
              {/* Amount */}
              {amount && (
                <span className="text-sm font-medium">{amount}</span>
              )}
              
              {/* Status and Time */}
              <div className="flex items-center gap-2 flex-wrap">
              {/* Pill-shaped status badge */}
              <div className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5',
                badgeBgColor,
                badgeTextColor,
                badgeBorderColor
              )}>
                {statusIcon}
                <span className="text-xs font-medium">{statusLabel}</span>
              </div>
              
              {hasClientTimeout(transaction) && (
                <div className="group relative">
                  <AlertCircle className="h-3.5 w-3.5 text-yellow-600" />
                  <div className="absolute bottom-full left-1/2 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 shadow-lg transition-opacity group-hover:block group-hover:opacity-100">
                    {getTimeoutMessage(transaction)}
                  </div>
                </div>
              )}
              
              {/* Time with clock icon */}
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  <span>{timeElapsed}</span>
                </div>
              </div>

              {/* Progress bar (for in-progress transactions) */}
              {isInProgress(transaction) && (
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
            </div>

            {/* Column 3: Actions - Action icons */}
            {!hideActions && (
          <div className="flex items-center gap-2 flex-shrink-0">
            {onDelete && (
                  <DropdownMenu
                    trigger={
              <button
                type="button"
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-muted/80 transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
                        aria-label="Transaction actions"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    }
                    align="right"
                  >
                    <DropdownMenuItem
                      onClick={() => {
                        setIsDeleteDialogOpen(true)
                      }}
                      stopPropagation
                      className="text-destructive hover:bg-destructive/10"
              >
                      <div className="flex items-center gap-2">
                <Trash2 className="h-4 w-4" />
                        <span>Delete</span>
                      </div>
                    </DropdownMenuItem>
                  </DropdownMenu>
            )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {showExpandButton && (
        <TransactionDetailModal
          transaction={transaction}
          open={isModalOpen}
          onClose={() => setIsModalOpen(false)}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {onDelete && (
        <DeleteTransactionConfirmationDialog
          open={isDeleteDialogOpen}
          onClose={() => setIsDeleteDialogOpen(false)}
          onConfirm={handleDeleteConfirm}
          transactionType={transaction.direction}
        />
      )}
    </>
  )
})

