import { useState, useEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Shield, Loader2, MoreVertical, RefreshCw, CheckCircle2, XCircle, ArrowDown, Send, AlertCircle } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { Tooltip } from '@/components/common/Tooltip'
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
import { balanceSyncAtom, balanceErrorsAtom } from '@/atoms/balanceAtom'
import { autoShieldedSyncEnabledAtom } from '@/atoms/appAtom'
import { isAnyTransactionActiveAtom, txUiAtom } from '@/atoms/txUiAtom'
import { cn } from '@/lib/utils'
import { transactionStorageService } from '@/services/tx/transactionStorageService'
import { formatTimeAgo } from '@/services/tx/transactionStatusService'

export function Dashboard() {
  const { state: balanceState } = useBalance()
  const { state: shieldedState, startSync, isReady } = useShieldedSync()
  const balanceSyncState = useAtomValue(balanceSyncAtom)
  const balanceErrors = useAtomValue(balanceErrorsAtom)
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
  
  // Check for balance calculation error states
  const hasShieldedError = balanceSyncState.shieldedStatus === 'error' && balanceErrors.shielded
  const hasTransparentError = balanceSyncState.transparentStatus === 'error' && balanceErrors.transparent
  
  const displayShieldedBalance = hasShieldedError ? '--' : shieldedBalance
  const displayTransparentBalance = hasTransparentError ? '--' : transparentBalance
  const hasShieldedBalance = displayShieldedBalance && displayShieldedBalance !== '--' && parseFloat(displayShieldedBalance) > 0

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
      <div className="flex flex-col gap-6 p-12 mx-auto w-full">

        {/* Balance and Actions Section + Recent Activity Side by Side */}
        <div className="flex flex-col lg:flex-row gap-6 mb-12">
          {/* Balance and Actions Section */}
          <div className="flex flex-col gap-8 flex-2 rounded-lg border border-border bg-card p-4 shadow-sm">
          {/* Section Header */}
          <div className="flex flex-col gap-2">
            <h2 className="text-md font-semibold">Cross-chain shielded USDC</h2>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              1. DEPOSIT ➔ 2. SHIELD ➔ 3. SEND
            </p>
          </div>

          {/* Unified Balance Card */}
          <div className="rounded-lg border border-slate-200 bg-slate-200/50 dark:from-slate-950/20 dark:to-slate-900/10 dark:border-slate-800/50 p-6 shadow-xs">
            <div className="flex items-start justify-between gap-6">
              {/* Left side: Transparent Balance */}
              <div className="flex-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Transparent Balance</p>
                <div className="flex items-center gap-2 mt-1">
                  <p className="text-2xl font-bold">{displayTransparentBalance} <span className="text-lg font-semibold text-muted-foreground">USDC</span></p>
                  {hasTransparentError && (
                    <Tooltip content="Could not query transparent balance from chain" side="top">
                      <AlertCircle className="h-4 w-4 text-red-500" aria-label="Transparent balance error" />
                    </Tooltip>
                  )}
                </div>
              </div>

              {/* Middle: Shielded Balance */}
              <div className="flex-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Shielded Balance</p>
                <div className="flex items-center gap-2 mt-1">
                  <p className="text-2xl font-bold">{displayShieldedBalance} <span className="text-lg font-semibold text-muted-foreground">USDC</span></p>
                  {isShieldedBalanceLoading && (
                    <Loader2 className="h-4 w-4 animate-spin text-red-500" aria-label="Loading shielded balance" />
                  )}
                  {hasShieldedError && (
                    <Tooltip content="Could not query shielded balances from chain" side="top">
                      <AlertCircle className="h-4 w-4 text-red-500" aria-label="Shielded balance error" />
                    </Tooltip>
                  )}
                </div>
                {timeAgoText && !hasShieldedError && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Last refreshed {timeAgoText}
                  </p>
                )}
              </div>

              {/* Right side: Sync Controls */}
              <div className="flex flex-col items-end gap-2">
                {/* Sync Button */}
                {(shieldedState.status === 'error' || hasShieldedError) ? (
                  <Button 
                    variant="ghost" 
                    className="h-7 px-3 text-xs gap-1.5 border border-border bg-transparent hover:bg-muted/50" 
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
                ) : isReady && !shieldedState.isSyncing && !hasShieldedError ? (
                  <Button 
                    variant="ghost" 
                    className="h-7 px-3 text-xs gap-1.5 border border-border bg-transparent hover:bg-muted/50" 
                    onClick={startSync}
                  >
                    {syncIconState === 'syncing' ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    ) : syncIconState === 'complete' ? (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    Sync Balance
                  </Button>
                ) : shieldedState.isSyncing ? (
                  <Button 
                    variant="ghost" 
                    className="h-7 px-3 text-xs gap-1.5 border border-border bg-transparent" 
                    disabled
                  >
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    Syncing Balance
                  </Button>
                ) : null}
                <div className="w-32">
                  <ShieldedSyncProgress compact />
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

          {/* Action Steps Section */}
          <div className="flex flex-col gap-0 rounded-lg overflow-hidden">
            {/* Step 1: Deposit */}
            <div className="p-6">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4 flex-1">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-muted-foreground/30 bg-transparent text-muted-foreground text-sm font-medium flex-shrink-0">
                    1
                  </div>
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium">Deposit transparent USDC</p>
                    <p className="text-xs text-muted-foreground">Add USDC from your connected Metamask wallet to your transparent balance.</p>
                  </div>
                </div>
                <Link to="/deposit" className="flex-shrink-0">
                  <Button 
                    variant="primary" 
                    className="gap-2 rounded-lg px-8 py-3 h-auto font-bold text-base"
                  >
                    <ArrowDown className="h-5 w-5" />Deposit USDC
                  </Button>
                </Link>
              </div>
            </div>

            {/* Divider */}
            <div className="h-px bg-border" />

            {/* Step 2: Shield */}
            <div className="p-6">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4 flex-1">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-muted-foreground/30 bg-transparent text-muted-foreground text-sm font-medium flex-shrink-0">
                    2
                  </div>
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium">Shield funds</p>
                    <p className="text-xs text-muted-foreground">Move funds from your transparent balance to your shielded balance.</p>
                  </div>
                </div>
                <div className="flex-shrink-0">
                  <Button
                    variant="primary"
                    className={cn(
                      "gap-2 rounded-lg px-8 py-3 h-auto font-bold text-base",
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
                    <Shield className="h-5 w-5" />Shield Funds
                  </Button>
                  {isAnyTxActive && (
                    <p className="text-xs text-muted-foreground text-center mt-2">
                      Please wait for the current {txUiState.transactionType || 'transaction'} to complete
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="h-px bg-border" />

            {/* Step 3: Send */}
            <div className="p-6">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4 flex-1">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-muted-foreground/30 bg-transparent text-muted-foreground text-sm font-medium flex-shrink-0">
                    3
                  </div>
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium">Send payment from shielded balance</p>
                    <p className="text-xs text-muted-foreground">Send shielded USDC cross-chain to another address.</p>
                  </div>
                </div>
                <Link to={hasShieldedBalance ? "/send" : "#"} className="flex-shrink-0" onClick={(e) => { if (!hasShieldedBalance) e.preventDefault() }}>
                  <Button 
                    variant="ghost" 
                    className={cn(
                      "gap-2 rounded-lg px-8 py-3 h-auto font-bold text-base",
                      "bg-yellow-500 hover:bg-yellow-600 text-yellow-950",
                      "transition-all duration-200",
                      !hasShieldedBalance && "opacity-50 cursor-not-allowed"
                    )}
                    disabled={!hasShieldedBalance}
                  >
                    <Send className="h-5 w-5" />
                    {hasShieldedBalance ? "Send Shielded USDC" : "Shield USDC first"}
                  </Button>
                </Link>
              </div>
            </div>
          </div>
          </div>

          {/* Transaction Activity Box */}
          <div className="flex-1 rounded-lg border border-border bg-card p-4 shadow-sm">
          {/* Section Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-md font-semibold">Recent activity</h2>
            <Link to="/history">
              <Button variant="ghost" className="h-6 px-2 text-xs">
                View All
              </Button>
            </Link>
          </div>

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
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              History
            </h2>
            <TxHistoryList
              openModalTxId={openModalTxId}
              onModalOpenChange={setOpenModalTxId}
              reloadTrigger={historyReloadTrigger}
            />
          </div>
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
