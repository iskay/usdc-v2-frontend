import { Link } from 'react-router-dom'
import { Shield, BookOpen, HelpCircle, RefreshCw, Loader2 } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { TxInProgressList } from '@/components/tx/TxInProgressList'
import { TxHistoryList } from '@/components/tx/TxHistoryList'
import { RequireNamadaConnection } from '@/components/wallet/RequireNamadaConnection'
import { ShieldedSyncProgress } from '@/components/shielded/ShieldedSyncProgress'
import { useBalance } from '@/hooks/useBalance'
import { useShieldedSync } from '@/hooks/useShieldedSync'
import { useAtomValue } from 'jotai'
import { balanceSyncAtom } from '@/atoms/balanceAtom'
import { cn } from '@/lib/utils'

export function Dashboard() {
  const { state: balanceState } = useBalance()
  const { startSync, isReady, state: shieldedState } = useShieldedSync()
  const balanceSyncState = useAtomValue(balanceSyncAtom)
  
  // Get balances from the balance state
  const shieldedBalance = balanceState.namada.usdcShielded
  const transparentBalance = balanceState.namada.usdcTransparent

  // Check if shielded balance is loading (sync or calculation in progress)
  const isShieldedBalanceLoading = shieldedState.isSyncing || balanceSyncState.shieldedStatus === 'calculating'

  return (
    <RequireNamadaConnection>
      <div className="flex flex-col gap-6 p-24">

        {/* Balance Section */}
        <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="flex flex-col items-start gap-3">
            <div className="flex items-center gap-3">
              <Shield className="h-6 w-6 text-yellow-600" />
              <span className="text-md font-semibold">Transparent: </span>
              <div>
                <span className="text-2xl font-semibold">{transparentBalance} USDC</span>
              </div>
              <Link to="/deposit">
                <Button variant="ghost" className="gap-2">
                  <span className="text-lg">+</span>
                  <span>deposit</span>
                </Button>
              </Link>
            </div>
            <div className="flex items-center gap-3">
              <Shield className="h-6 w-6 text-red-600" />
              <span className="text-md font-semibold">Shielded: </span>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-semibold">{shieldedBalance} USDC</span>
                {isShieldedBalanceLoading && (
                  <Loader2 className="h-5 w-5 animate-spin text-blue-500" aria-label="Loading shielded balance" />
                )}
              </div>
              <Button variant="ghost" className="gap-2">
                <span className="text-lg">+</span>
                <span>shield</span>
              </Button>
              {isReady && (
                <Button
                  variant="ghost"
                  className="gap-2"
                  onClick={startSync}
                  disabled={shieldedState.isSyncing}
                  title="Sync shielded balance"
                >
                  <RefreshCw className={cn('h-4 w-4', shieldedState.isSyncing && 'animate-spin')} />
                  <span>sync</span>
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Shielded Sync Progress */}
        <ShieldedSyncProgress />

        {/* Action Buttons */}
        <div className="flex flex-col gap-3">
          <Link to="/send">
            <Button variant="primary" className="w-full">
              Pay
            </Button>
          </Link>
          {/* <Link to="/deposit">
          <Button variant="secondary" className="w-full">
            Get Paid
          </Button>
        </Link> */}
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
