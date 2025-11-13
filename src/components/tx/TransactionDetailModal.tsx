import { useEffect } from 'react'
import { X, CheckCircle2, XCircle, Clock, AlertCircle, ExternalLink } from 'lucide-react'
import type { StoredTransaction } from '@/services/tx/transactionStorageService'
import {
  isInProgress,
  isSuccess,
  isError,
  getStatusLabel,
  getTimeElapsed,
  getTotalDurationLabel,
  getProgressPercentage,
  getStageTimings,
  getCurrentStage,
} from '@/services/tx/transactionStatusService'
import { cn } from '@/lib/utils'

export interface TransactionDetailModalProps {
  transaction: StoredTransaction
  open: boolean
  onClose: () => void
}

export function TransactionDetailModal({
  transaction,
  open,
  onClose,
}: TransactionDetailModalProps) {
  // Handle Escape key to close modal
  useEffect(() => {
    if (!open) return

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open, onClose])

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }

    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  if (!open) {
    return null
  }

  const flowType = transaction.direction === 'deposit' ? 'deposit' : 'payment'
  const statusLabel = getStatusLabel(transaction)
  const timeElapsed = getTimeElapsed(transaction)
  const totalDuration = getTotalDurationLabel(transaction)
  const progress = getProgressPercentage(transaction, flowType)
  const stageTimings = getStageTimings(transaction, flowType)
  const currentStage = getCurrentStage(transaction, flowType)

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
  let statusIcon = <Clock className="h-5 w-5" />
  let statusColor = 'text-muted-foreground'

  if (isSuccess(transaction)) {
    statusIcon = <CheckCircle2 className="h-5 w-5" />
    statusColor = 'text-green-600'
  } else if (isError(transaction)) {
    statusIcon = <XCircle className="h-5 w-5" />
    statusColor = 'text-red-600'
  } else if (transaction.status === 'undetermined') {
    statusIcon = <AlertCircle className="h-5 w-5" />
    statusColor = 'text-yellow-600'
  }

  // Format address for display (truncate middle)
  function formatAddress(address: string): string {
    if (address.length <= 10) return address
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  // Format transaction hash
  function formatHash(hash: string): string {
    if (hash.length <= 10) return hash
    return `${hash.slice(0, 8)}...${hash.slice(-6)}`
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Content */}
      <div className="relative z-50 w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg border border-border bg-background shadow-lg">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background p-6">
          <div className="flex items-center gap-3">
            <div className={cn('flex items-center gap-2', statusColor)}>
              {statusIcon}
              <h2 className="text-xl font-semibold">
                {transaction.direction === 'deposit' ? 'Deposit' : 'Payment'} Details
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Transaction Summary */}
          <div className="rounded-lg border border-border bg-muted/40 p-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-muted-foreground">Status</dt>
                <dd className={cn('mt-1 font-medium', statusColor)}>{statusLabel}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Time Elapsed</dt>
                <dd className="mt-1 font-medium">{timeElapsed}</dd>
              </div>
              {amount && (
                <div>
                  <dt className="text-muted-foreground">Amount</dt>
                  <dd className="mt-1 font-medium">{amount} USDC</dd>
                </div>
              )}
              <div>
                <dt className="text-muted-foreground">Chain</dt>
                <dd className="mt-1 font-medium capitalize">{transaction.chain}</dd>
              </div>
              {transaction.hash && (
                <div className="col-span-2">
                  <dt className="text-muted-foreground">Transaction Hash</dt>
                  <dd className="mt-1 font-mono text-sm">{formatHash(transaction.hash)}</dd>
                </div>
              )}
              {transaction.flowId && (
                <div className="col-span-2">
                  <dt className="text-muted-foreground">Flow ID</dt>
                  <dd className="mt-1 font-mono text-sm">{transaction.flowId}</dd>
                </div>
              )}
            </div>
          </div>

          {/* Progress Bar */}
          {isInProgress(transaction) && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Progress</span>
                <span className="font-medium">{progress}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Current Stage */}
          {currentStage && (
            <div className="rounded-md bg-muted/50 p-4">
              <div className="flex items-center gap-2 text-sm">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium capitalize">
                  Current Stage: {currentStage.stage.replace(/_/g, ' ')}
                </span>
                <span className="text-muted-foreground">on {currentStage.chain.toUpperCase()}</span>
              </div>
              {currentStage.durationLabel && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Time in this stage: {currentStage.durationLabel}
                </p>
              )}
            </div>
          )}

          {/* Stage Timeline */}
          {stageTimings.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold uppercase text-muted-foreground">
                Stage Timeline
              </h3>
              <div className="space-y-3">
                {stageTimings.map((timing, index) => {
                  const isLast = index === stageTimings.length - 1
                  const timingIcon =
                    timing.status === 'confirmed' ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : timing.status === 'failed' ? (
                      <XCircle className="h-4 w-4 text-red-600" />
                    ) : (
                      <Clock className="h-4 w-4 text-muted-foreground" />
                    )

                  return (
                    <div key={`${timing.chain}-${timing.stage}-${index}`} className="relative pl-8">
                      {/* Timeline line */}
                      {!isLast && (
                        <div className="absolute left-3 top-6 h-full w-0.5 bg-border" />
                      )}

                      {/* Stage content */}
                      <div className="flex items-start gap-3">
                        <div className="relative z-10 -ml-8 flex h-6 w-6 items-center justify-center rounded-full bg-background">
                          {timingIcon}
                        </div>
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2 text-sm">
                            <span className="font-medium capitalize">
                              {timing.stage.replace(/_/g, ' ')}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              ({timing.chain.toUpperCase()})
                            </span>
                          </div>
                          {timing.durationLabel && (
                            <p className="text-xs text-muted-foreground">
                              Duration: {timing.durationLabel}
                            </p>
                          )}
                          {timing.occurredAt && (
                            <p className="text-xs text-muted-foreground">
                              {new Date(timing.occurredAt).toLocaleString()}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Error Message */}
          {transaction.errorMessage && (
            <div className="rounded-md border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
              <div className="flex items-start gap-2">
                <XCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-900 dark:text-red-100">Error</p>
                  <p className="mt-1 text-sm text-red-800 dark:text-red-200">
                    {transaction.errorMessage}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Undetermined Status Notice */}
          {transaction.status === 'undetermined' && (
            <div className="rounded-md border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-950">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-yellow-900 dark:text-yellow-100">
                    Status Unknown
                  </p>
                  <p className="mt-1 text-sm text-yellow-800 dark:text-yellow-200">
                    The transaction status could not be determined within the timeout period. The
                    transaction may have succeeded or failed, but we were unable to confirm its final
                    state.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Total Duration */}
          {totalDuration && (
            <div className="text-xs text-muted-foreground">
              Total duration: {totalDuration}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

