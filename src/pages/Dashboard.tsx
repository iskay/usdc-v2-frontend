import { Link } from 'react-router-dom'
import { Shield, BookOpen, HelpCircle } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { TxInProgressList } from '@/components/tx/TxInProgressList'
import { TxHistoryList } from '@/components/tx/TxHistoryList'
import { RequireNamadaConnection } from '@/components/wallet/RequireNamadaConnection'

export function Dashboard() {
  // TODO: Fetch actual shielded balance from Namada SDK
  const shieldedBalance = '356.20'

  return (
    <RequireNamadaConnection>
      <div className="flex flex-col gap-6 p-24">

      {/* Balance Section */}
      <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Shield className="h-6 w-6 text-red-600" />
          <div>
            <span className="text-2xl font-semibold">{shieldedBalance} USDC</span>
          </div>
        </div>
        <Link to="/deposit">
          <Button variant="ghost" className="gap-2">
            <span className="text-lg">+</span>
            <span>deposit</span>
          </Button>
        </Link>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col gap-3">
        <Link to="/send">
          <Button variant="primary" className="w-full">
            Pay
          </Button>
        </Link>
        <Link to="/deposit">
          <Button variant="secondary" className="w-full">
            Get Paid
          </Button>
        </Link>
      </div>

      {/* Transaction Activity Box */}
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        {/* In Progress Section */}
        <div className="mb-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            In Progress
          </h2>
          <TxInProgressList />
        </div>

        {/* History Section */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              History
            </h2>
            <Link to="/history">
              <Button variant="ghost" className="h-6 px-2 text-xs">
                All
              </Button>
            </Link>
          </div>
          <TxHistoryList />
        </div>
      </div>

      {/* Bottom Icons */}
      <div className="flex items-center justify-end gap-4">
        <button
          type="button"
          className="text-blue-500 hover:text-blue-600"
          aria-label="Documentation"
        >
          <BookOpen className="h-5 w-5" />
        </button>
        <button
          type="button"
          className="text-red-500 hover:text-red-600"
          aria-label="Help"
        >
          <HelpCircle className="h-5 w-5" />
        </button>
      </div>
    </div>
    </RequireNamadaConnection>
  )
}
