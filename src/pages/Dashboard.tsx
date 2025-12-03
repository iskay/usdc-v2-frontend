import { useState, useEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Shield, Eye, Loader2, ArrowRight, MoreVertical, RefreshCw, CheckCircle2, XCircle } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { Switch } from '@/components/common/Switch'
import { DropdownMenu, DropdownMenuItem } from '@/components/common/DropdownMenu'
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
import { isAnyTransactionActiveAtom, txUiAtom } from '@/atoms/txUiAtom'
import { cn } from '@/lib/utils'
import { transactionStorageService } from '@/services/tx/transactionStorageService'
import { formatTimeAgo } from '@/services/tx/transactionStatusService'

export function Dashboard() {
  const { state: balanceState } = useBalance()
  const { state: shieldedState, startSync, isReady } = useShieldedSync()
  const balanceSyncState = useAtomValue(balanceSyncAtom)
  const isAnyTxActive = useAtomValue(isAnyTransactionActiveAtom)
  const txUiState = useAtomValue(txUiAtom)
  const [autoShieldedSyncEnabled, setAutoShieldedSyncEnabled] = useAtom(autoShieldedSyncEnabledAtom)
  const [isShieldingModalOpen, setIsShieldingModalOpen] = useState(false)
  const [openModalTxId, setOpenModalTxId] = useState<string | null>(null)
  const [historyReloadTrigger, setHistoryReloadTrigger] = useState(0)
  const previousInProgressTxIds = useRef<Set<string>>(new Set())
  const [searchParams, setSearchParams] = useSearchParams()
  const [timeAgoText, setTimeAgoText] = useState<string>('')
  const lastUpdatedTimestampRef = useRef<number | undefined>(undefined)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [syncIconState, setSyncIconState] = useState<'idle' | 'syncing' | 'complete' | 'error'>('idle')
  const syncCompleteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Handle tx query parameter to open transaction modal
  useEffect(() => {
    const txId = searchParams.get('tx')
    if (txId) {
      // Verify transaction exists before opening modal
      const allTxs = [
        ...transactionStorageService.getInProgressTransactions(),
        ...transactionStorageService.getCompletedTransactions(),
      ]
      const txExists = allTxs.some(tx => tx.id === txId)
      
      if (txExists) {
        setOpenModalTxId(txId)
        // Remove query parameter from URL after opening modal
        searchParams.delete('tx')
        setSearchParams(searchParams, { replace: true })
      }
    }
  }, [searchParams, setSearchParams])

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

  // Extract timestamp to a stable primitive value (not object reference)
  const currentTimestamp = balanceState.namada.shieldedLastUpdated

  // Track sync icon state based on shielded sync status
  useEffect(() => {
    // Clear any existing timeout
    if (syncCompleteTimeoutRef.current) {
      clearTimeout(syncCompleteTimeoutRef.current)
      syncCompleteTimeoutRef.current = null
    }

    if (shieldedState.isSyncing) {
      setSyncIconState('syncing')
    } else if (shieldedState.status === 'complete') {
      setSyncIconState('complete')
      // Reset to idle after 15 seconds
      syncCompleteTimeoutRef.current = setTimeout(() => {
        setSyncIconState('idle')
      }, 15000)
    } else if (shieldedState.status === 'error') {
      setSyncIconState('error')
      // Reset to idle after 15 seconds
      syncCompleteTimeoutRef.current = setTimeout(() => {
        setSyncIconState('idle')
      }, 15000)
    } else {
      setSyncIconState('idle')
    }

    return () => {
      if (syncCompleteTimeoutRef.current) {
        clearTimeout(syncCompleteTimeoutRef.current)
      }
    }
  }, [shieldedState.isSyncing, shieldedState.status])

  // Update time ago text when timestamp changes
  useEffect(() => {
    if (currentTimestamp) {
      setTimeAgoText(formatTimeAgo(currentTimestamp))
    } else {
      setTimeAgoText('')
    }
  }, [currentTimestamp])

  // Update time ago display periodically
  useEffect(() => {
    // Only update interval if timestamp value actually changed
    const timestampChanged = currentTimestamp !== lastUpdatedTimestampRef.current
    
    if (!currentTimestamp) {
      // Clear interval if timestamp is removed
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      lastUpdatedTimestampRef.current = undefined
      return
    }
    
    // Create/recreate interval if timestamp changed OR interval doesn't exist
    if (timestampChanged || !intervalRef.current) {
      // Clear existing interval if it exists
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
      
      // Update ref to track current timestamp
      lastUpdatedTimestampRef.current = currentTimestamp
      
      // Create new interval to update time ago text every 15 seconds
      // Use the ref value so the callback always has the latest timestamp
      intervalRef.current = setInterval(() => {
        const latestTimestamp = lastUpdatedTimestampRef.current
        if (latestTimestamp) {
          setTimeAgoText(formatTimeAgo(latestTimestamp))
        }
      }, 15000) // Update every 15 seconds
    }
    
    return () => {
      // Only cleanup on unmount - don't cleanup on every re-render
      // The interval should persist across re-renders unless timestamp changes
      // We handle interval recreation in the effect body above
    }
    // Only restart interval if timestamp value actually changed, not on every balance state update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTimestamp])

  return (
    <RequireNamadaConnection>
      <div className="flex flex-col gap-6 p-12 max-w-[1024px] mx-auto w-full">

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
          <div className="flex flex-col items-center justify-center md:flex-col gap-2">
            <Button
              variant="ghost"
              className={cn(
                "gap-2 rounded-full p-4 h-auto font-bold text-base",
                "bg-yellow-500 hover:bg-yellow-600 text-yellow-950",
                "border-2 border-yellow-600 shadow-lg",
                "transition-all duration-200",
                hasTransparentBalance && !isShieldedBalanceLoading && !isAnyTxActive && "animate-shield-blink",
                (isShieldedBalanceLoading || !hasTransparentBalance || isAnyTxActive) && "opacity-50 cursor-not-allowed"
              )}
              onClick={() => {
                // Prevent opening if any transaction is active
                if (!isAnyTxActive) {
                  setIsShieldingModalOpen(true)
                }
              }}
              disabled={isAnyTxActive || isShieldedBalanceLoading || !hasTransparentBalance}
              title={
                isAnyTxActive
                  ? `Please wait for the current ${txUiState.transactionType || 'transaction'} to complete`
                  : !hasTransparentBalance
                  ? 'No transparent balance to shield'
                  : 'Shield USDC'
              }
            >
              <ArrowRight className="h-5 w-5 md:rotate-0 rotate-90" />Shield
            </Button>
            {isAnyTxActive && (
              <p className="text-xs text-muted-foreground text-center max-w-[200px]">
                Please wait for the current {txUiState.transactionType || 'transaction'} to complete
              </p>
            )}
          </div>

          {/* Shielded Balance Card */}
          <div className="rounded-lg border border-red-200/50 bg-gradient-to-br from-red-50/50 to-red-100/30 dark:from-red-950/20 dark:to-red-900/10 dark:border-red-800/50 p-6 shadow-sm flex-1">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/20 dark:bg-red-600/20">
                  <Shield className="h-5 w-5 text-red-600 dark:text-red-500" />
                </div>
                <div className="flex-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Shielded</p>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-2xl font-bold">{shieldedBalance} <span className="text-lg font-semibold text-muted-foreground">USDC</span></p>
                    {isShieldedBalanceLoading && (
                      <Loader2 className="h-4 w-4 animate-spin text-red-500" aria-label="Loading shielded balance" />
                    )}
                  </div>
                  {timeAgoText && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Last refreshed {timeAgoText}
                    </p>
                  )}
                  {/* Sync Progress - inline */}
                  <div className="mt-2 flex items-center gap-2">
                    {/* Sync Button */}
                    {shieldedState.status === 'error' ? (
                      <Button 
                        variant="primary" 
                        className="h-7 px-3 text-xs gap-1.5" 
                        onClick={startSync} 
                        disabled={!isReady || shieldedState.isSyncing}
                      >
                        {syncIconState === 'syncing' ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : syncIconState === 'error' ? (
                          <XCircle className="h-3.5 w-3.5" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        Retry
                      </Button>
                    ) : isReady && !shieldedState.isSyncing ? (
                      <Button 
                        variant="primary" 
                        className="h-7 px-3 text-xs gap-1.5" 
                        onClick={startSync}
                      >
                        {syncIconState === 'syncing' ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : syncIconState === 'complete' ? (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        Sync
                      </Button>
                    ) : shieldedState.isSyncing ? (
                      <Button 
                        variant="primary" 
                        className="h-7 px-3 text-xs gap-1.5" 
                        disabled
                      >
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        Sync
                      </Button>
                    ) : null}
                    <div className="flex-1">
                      <ShieldedSyncProgress compact />
                    </div>
                  </div>
                </div>
              </div>
              {/* Settings Dropdown */}
              <DropdownMenu
                align="right"
                trigger={
                  <button
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-red-100/50 dark:hover:bg-red-900/20 hover:text-foreground transition-colors"
                    aria-label="Shielded balance settings"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                }
                className="bg-background/95 backdrop-blur-sm"
              >
                <DropdownMenuItem 
                  className="flex items-center justify-between"
                  stopPropagation
                >
                  <div className="flex flex-col gap-0.5">
                    <label htmlFor="auto-shielded-sync-toggle" className="text-sm font-medium cursor-pointer">
                      Auto Sync
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Sync during polling
                    </p>
                  </div>
                  <div onClick={(e) => e.stopPropagation()}>
                    <Switch
                      id="auto-shielded-sync-toggle"
                      checked={autoShieldedSyncEnabled}
                      onCheckedChange={setAutoShieldedSyncEnabled}
                      aria-label="Toggle automatic shielded sync during polling"
                    />
                  </div>
                </DropdownMenuItem>
              </DropdownMenu>
            </div>
          </div>
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
        <div className='min-h-12' />

        {/* Shielding Modal */}
        <ShieldingModal
          open={isShieldingModalOpen}
          onClose={() => {
            // Only allow closing if no transaction is active
            if (!isAnyTxActive) {
              setIsShieldingModalOpen(false)
            }
          }}
        />
      </div>
    </RequireNamadaConnection>
  )
}
