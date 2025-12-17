import { X, CheckCircle2, XCircle, Clock, AlertCircle } from 'lucide-react'
import type { StoredTransaction } from '@/services/tx/transactionStorageService'
import { isSuccess, isError, getEffectiveStatus } from '@/services/tx/transactionStatusService'
import { cn } from '@/lib/utils'
import type { EvmChainsFile } from '@/config/chains'
import { getEvmChainLogo } from '@/utils/chainUtils'

export interface TransactionDetailModalHeaderProps {
  transaction: StoredTransaction
  evmChainsConfig: EvmChainsFile | null
  statusLabel: string
  startedAt: string
  onClose: () => void
}

export function TransactionDetailModalHeader({
  transaction,
  evmChainsConfig,
  statusLabel,
  startedAt,
  onClose,
}: TransactionDetailModalHeaderProps) {
  const effectiveStatus = getEffectiveStatus(transaction)

  // Status icon
  let statusIcon = <Clock className="h-5 w-5" />
  if (isSuccess(transaction)) {
    statusIcon = <CheckCircle2 className="h-5 w-5" />
  } else if (isError(transaction)) {
    statusIcon = <XCircle className="h-5 w-5" />
  } else if (effectiveStatus === 'user_action_required') {
    statusIcon = <AlertCircle className="h-5 w-5" />
  } else if (effectiveStatus === 'undetermined') {
    statusIcon = <AlertCircle className="h-5 w-5" />
  }

  const chainLogo = getEvmChainLogo(transaction, evmChainsConfig)

  return (
    <div className="sticky top-0 z-20 flex items-center justify-between bg-background p-6">
      <div className="flex items-baseline justify-between flex-1 pr-4 gap-1">
        <div className="flex items-center gap-2">
          {/* For deposits: logo → arrow → "Deposit" */}
          {/* For payments: "Payment" → arrow → logo */}
          {transaction.direction === 'deposit' ? (
            <>
              {chainLogo && (
                <img
                  src={chainLogo}
                  alt={transaction.depositDetails?.chainName || transaction.chain || 'Source'}
                  className="h-6 w-6 rounded-full flex-shrink-0 object-contain"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none'
                  }}
                />
              )}
              <div className="text-muted-foreground">
                →
              </div>
              <h2 className="text-xl font-semibold">
                Deposit
              </h2>
            </>
          ) : (
            <>
              <h2 className="text-xl font-semibold">
                Payment
              </h2>
              <div className="text-muted-foreground">
                →
              </div>
              {chainLogo && (
                <img
                  src={chainLogo}
                  alt={transaction.paymentDetails?.chainName || transaction.chain || 'Destination'}
                  className="h-6 w-6 rounded-full flex-shrink-0 object-contain"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none'
                  }}
                />
              )}
            </>
          )}
        </div>
        <p className="text-xs text-muted-foreground self-center">
          Sent {startedAt}
        </p>
      </div>
      <div className="flex items-center gap-3">
        {/* Status Badge */}
        <div className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1',
          isSuccess(transaction) ? 'bg-success/10 text-success' :
            isError(transaction) ? 'bg-error/10 text-error' :
              effectiveStatus === 'user_action_required' ? 'bg-warning/10 text-warning' :
                effectiveStatus === 'undetermined' ? 'bg-warning/10 text-warning' :
                  'bg-muted text-muted-foreground'
        )}>
          {statusIcon}
          <span className="text-xs font-medium">{statusLabel}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 text-muted-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label="Close modal"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}

