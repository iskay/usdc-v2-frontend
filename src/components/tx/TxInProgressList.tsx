import { Clock, Shield } from 'lucide-react'
import { useTxTracker } from '@/hooks/useTxTracker'

export function TxInProgressList() {
  const { state } = useTxTracker()

  // Filter transactions that are in progress (not completed or error)
  const inProgressTxs = [
    ...(state.activeTransaction && state.activeTransaction.status !== 'finalized' && state.activeTransaction.status !== 'error'
      ? [state.activeTransaction]
      : []),
    ...state.history.filter(
      (tx) => tx.status !== 'finalized' && tx.status !== 'error' && tx.status !== 'idle',
    ),
  ]

  if (inProgressTxs.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No transactions in progress.
      </div>
    )
  }

  return (
    <ul className="space-y-2">
      {inProgressTxs.map((tx) => {
        const isDeposit = tx.direction === 'deposit'
        const isShielding = tx.status === 'building' || tx.status === 'signing'

        return (
          <li key={tx.id} className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">-</span>
            <span className="capitalize">
              {isDeposit ? 'Deposit' : 'Pay'} {/* TODO: Show actual amount from tx */}
            </span>
            <span className="text-muted-foreground">[]</span>
            <span className="text-muted-foreground">---</span>
            {isShielding ? (
              <>
                <Shield className="h-4 w-4 text-red-600" />
                <span className="text-xs text-red-600 underline">shield</span>
              </>
            ) : (
              <>
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  ~{estimateTime(tx.status)} mins
                </span>
              </>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function estimateTime(status: string): string {
  // TODO: Calculate actual time remaining based on tx status and chain
  const estimates: Record<string, string> = {
    submitting: '3',
    broadcasted: '2',
    building: '1',
    signing: '1',
  }
  return estimates[status] ?? '3'
}

