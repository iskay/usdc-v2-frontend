import { Button } from '@/components/common/Button'
import { useTxTracker } from '@/hooks/useTxTracker'

export function TxStatusCard() {
  const { state, clearActive } = useTxTracker()
  const tx = state.activeTransaction

  if (!tx) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <p className="text-sm text-muted-foreground">No active transactions.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4 shadow-sm">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase text-muted-foreground">Active Transaction</p>
          <h3 className="text-lg font-semibold">{tx.direction === 'deposit' ? 'Deposit' : 'Payment'} flow</h3>
        </div>
        <Button variant="ghost" onClick={clearActive}>
          Clear
        </Button>
      </header>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-muted-foreground">Chain</dt>
          <dd className="font-medium">{tx.chain}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Status</dt>
          <dd className="font-medium capitalize">{tx.status.replace('-', ' ')}</dd>
        </div>
      </dl>
      {/* TODO: Display progress timeline once txTracker integrates backend updates. */}
    </div>
  )
}
