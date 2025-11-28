import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Shield, Eye, RefreshCw, Loader2, ArrowRight } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { Switch } from '@/components/common/Switch'
import { TxInProgressList } from '@/components/tx/TxInProgressList'
import { TxHistoryList } from '@/components/tx/TxHistoryList'
import { RequireNamadaConnection } from '@/components/wallet/RequireNamadaConnection'
import { ShieldedSyncProgress } from '@/components/shielded/ShieldedSyncProgress'
import { ShieldingModal } from '@/components/shielded/ShieldingModal'
import { useBalance } from '@/hooks/useBalance'
import { useShieldedSync } from '@/hooks/useShieldedSync'
import { useAtom, useAtomValue } from 'jotai'
import { balanceSyncAtom } from '@/atoms/balanceAtom'
import { autoShieldedSyncEnabledAtom } from '@/atoms/appAtom'
import { cn } from '@/lib/utils'
import { transactionStorageService } from '@/services/tx/transactionStorageService'

export function Dashboard() {
  const { state: balanceState } = useBalance()
  const { startSync, isReady, state: shieldedState } = useShieldedSync()
  const balanceSyncState = useAtomValue(balanceSyncAtom)
  const [autoShieldedSyncEnabled, setAutoShieldedSyncEnabled] = useAtom(autoShieldedSyncEnabledAtom)
  const [isShieldingModalOpen, setIsShieldingModalOpen] = useState(false)
  const [openModalTxId, setOpenModalTxId] = useState<string | null>(null)
  const [historyReloadTrigger, setHistoryReloadTrigger] = useState(0)
  const previousInProgressTxIds = useRef<Set<string>>(new Set())

  // Monitor in-progress transactions to detect when one completes
  useEffect(() => {
    const checkForCompletedTransactions = () => {
      const currentInProgressTxs = transactionStorageService.getInProgressTransactions()
      const currentInProgressTxIds = new Set(currentInProgressTxs.map(tx => tx.id))
      
      // Check if any transaction disappeared from in-progress (moved to history)
      const disappearedTxIds = Array.from(previousInProgressTxIds.current).filter(
        txId => !currentInProgressTxIds.has(txId)
      )
      
      // If a transaction disappeared and we have a modal open for it, trigger History reload
      if (disappearedTxIds.length > 0 && openModalTxId && disappearedTxIds.includes(openModalTxId)) {
        setHistoryReloadTrigger(prev => prev + 1)
      }
      
      // Update previous set for next check
      previousInProgressTxIds.current = currentInProgressTxIds
    }

    // Check immediately on mount
    checkForCompletedTransactions()

    // Check periodically (every 2 seconds - more frequent than polling to catch transitions quickly)
    const interval = setInterval(checkForCompletedTransactions, 2000)
    return () => clearInterval(interval)
  }, [openModalTxId])
  
  // Get balances from the balance state
  const shieldedBalance = balanceState.namada.usdcShielded
  const transparentBalance = balanceState.namada.usdcTransparent
  const hasTransparentBalance = parseFloat(transparentBalance || '0') > 0

  // Check if shielded balance is loading (sync or calculation in progress)
  const isShieldedBalanceLoading = shieldedState.isSyncing || balanceSyncState.shieldedStatus === 'calculating'

  return (
    <RequireNamadaConnection>
      <div className="flex flex-col gap-6 p-24 max-w-[1024px] mx-auto w-full">

        {/* Balance Section */}
        <div className="flex flex-col md:flex-row items-center md:items-stretch gap-4">
          {/* Transparent Balance Card */}
          <div className="rounded-lg border border-yellow-200/50 bg-gradient-to-br from-yellow-50/50 to-yellow-100/30 dark:from-yellow-950/20 dark:to-yellow-900/10 dark:border-yellow-800/50 p-6 shadow-sm flex-1">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-500/20 dark:bg-yellow-600/20">
                  <Eye className="h-5 w-5 text-yellow-600 dark:text-yellow-500" />
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Transparent</p>
                  <p className="text-2xl font-bold mt-1">{transparentBalance} <span className="text-lg font-semibold text-muted-foreground">USDC</span></p>
                </div>
              </div>
            </div>
            <Link to="/deposit">
              <Button variant="ghost" className="w-full gap-2 hover:bg-yellow-100/50 dark:hover:bg-yellow-900/20">
                <span className="text-lg">+</span>
                <span>Deposit</span>
              </Button>
            </Link>
          </div>

          {/* Shield Button - Centered between cards */}
          <div className="flex items-center justify-center md:flex-col">
            <Button
              variant="ghost"
              className={cn(
                "gap-2 rounded-full p-4 h-auto font-bold text-base",
                "bg-yellow-500 hover:bg-yellow-600 text-yellow-950",
                "border-2 border-yellow-600 shadow-lg",
                "transition-all duration-200",
                hasTransparentBalance && !isShieldedBalanceLoading && "animate-shield-blink",
                (isShieldedBalanceLoading || !hasTransparentBalance) && "opacity-50 cursor-not-allowed"
              )}
              onClick={() => setIsShieldingModalOpen(true)}
              disabled={isShieldedBalanceLoading || !hasTransparentBalance}
              title={!hasTransparentBalance ? 'No transparent balance to shield' : 'Shield USDC'}
            >
              <ArrowRight className="h-5 w-5 md:rotate-0 rotate-90" />Shield
            </Button>
          </div>

          {/* Shielded Balance Card */}
          <div className="rounded-lg border border-red-200/50 bg-gradient-to-br from-red-50/50 to-red-100/30 dark:from-red-950/20 dark:to-red-900/10 dark:border-red-800/50 p-6 shadow-sm flex-1">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/20 dark:bg-red-600/20">
                  <Shield className="h-5 w-5 text-red-600 dark:text-red-500" />
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Shielded</p>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-2xl font-bold">{shieldedBalance} <span className="text-lg font-semibold text-muted-foreground">USDC</span></p>
                    {isShieldedBalanceLoading && (
                      <Loader2 className="h-4 w-4 animate-spin text-red-500" aria-label="Loading shielded balance" />
                    )}
                  </div>
                </div>
              </div>
            </div>
            {isReady && (
              <Button
                variant="ghost"
                className="w-full gap-2 hover:bg-red-100/50 dark:hover:bg-red-900/20 h-12"
                onClick={startSync}
                disabled={shieldedState.isSyncing}
                title="Sync shielded balance"
              >
                <RefreshCw className={cn('h-4 w-4', shieldedState.isSyncing && 'animate-spin')} />
                <span>Sync</span>
              </Button>
            )}
          </div>
        </div>

        {/* Shielded Sync Progress */}
        <ShieldedSyncProgress />

        {/* Auto Sync Toggle */}
        <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="flex flex-col gap-1">
            <label htmlFor="auto-shielded-sync-toggle" className="text-sm font-semibold">
              Auto Sync Shielded Balance
            </label>
            <p className="text-xs text-muted-foreground">
              Automatically sync and calculate shielded balance during polling intervals
            </p>
          </div>
          <Switch
            id="auto-shielded-sync-toggle"
            checked={autoShieldedSyncEnabled}
            onCheckedChange={setAutoShieldedSyncEnabled}
            aria-label="Toggle automatic shielded sync during polling"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col gap-3">
          <Link to="/send">
            <Button variant="primary" className="w-full min-h-16">
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
            <TxInProgressList
              openModalTxId={openModalTxId}
              onModalOpenChange={setOpenModalTxId}
            />
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
            <TxHistoryList
              openModalTxId={openModalTxId}
              onModalOpenChange={setOpenModalTxId}
              reloadTrigger={historyReloadTrigger}
            />
          </div>
        </div>

        {/* Shielding Modal */}
        <ShieldingModal
          open={isShieldingModalOpen}
          onClose={() => setIsShieldingModalOpen(false)}
        />
      </div>
    </RequireNamadaConnection>
  )
}
