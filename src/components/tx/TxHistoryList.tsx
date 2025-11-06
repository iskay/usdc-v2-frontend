import { Check, X } from 'lucide-react'
import { useTxTracker } from '@/hooks/useTxTracker'

export function TxHistoryList() {
  const { state } = useTxTracker()

  // Filter completed transactions (finalized or error)
  const completedTxs = state.history.filter(
    (tx) => tx.status === 'finalized' || tx.status === 'error',
  )

  if (completedTxs.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        History will appear after your first transaction.
      </div>
    )
  }

  return (
    <ul className="space-y-2">
      {completedTxs.slice(0, 5).map((tx) => {
        const isSuccess = tx.status === 'finalized'
        const isDeposit = tx.direction === 'deposit'
        const recipient = tx.hash ? formatAddress(tx.hash) : 'N/A'

        return (
          <li key={tx.id} className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">-</span>
            <span className="capitalize">
              {isDeposit ? 'Deposit' : 'Pay'} {/* TODO: Show actual amount from tx */}
            </span>
            {!isDeposit && (
              <>
                <span className="text-muted-foreground">to</span>
                <span className="text-muted-foreground">[{recipient}]</span>
              </>
            )}
            {isSuccess ? (
              <Check className="h-4 w-4 text-green-600" />
            ) : (
              <X className="h-4 w-4 text-red-600" />
            )}
          </li>
        )
      })}
    </ul>
  )
}

function formatAddress(address: string): string {
  if (address.length <= 10) return address
  return `${address.slice(0, 3)}..${address.slice(-3)}`
}

