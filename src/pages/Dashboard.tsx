import { useState, useEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Shield, Loader2, RefreshCw, CheckCircle2, XCircle, ArrowDownLeft, Send, AlertCircle, ChevronRight } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { Tooltip } from '@/components/common/Tooltip'
import { TxInProgressList } from '@/components/tx/TxInProgressList'
import { TxHistoryList } from '@/components/tx/TxHistoryList'
import { RequireNamadaConnection } from '@/components/wallet/RequireNamadaConnection'
import { ShieldedSyncProgress } from '@/components/shielded/ShieldedSyncProgress'
import { ShieldingModal } from '@/components/shielded/ShieldingModal'
import { useBalance } from '@/hooks/useBalance'
import { useShieldedSync } from '@/hooks/useShieldedSync'
import { useAtomValue } from 'jotai'
import { balanceSyncAtom, balanceErrorsAtom } from '@/atoms/balanceAtom'
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

  // Calculate dot indicator state
  const showRefreshIndicator = !hasShieldedError && !isShieldedBalanceLoading && currentTimestamp && timeAgoText
  const timeSinceRefresh = currentTimestamp ? Date.now() - currentTimestamp : null
  const isRecentRefresh = timeSinceRefresh !== null && timeSinceRefresh < 60000 // Less than 1 minute
  const refreshIndicatorColor = isRecentRefresh ? 'bg-success' : 'bg-warning'

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
      <div className="flex flex-col gap-6 p-12 mx-auto w-full container">

        {/* Balance and Actions Section + Recent Activity Side by Side */}
        <div className="flex flex-col lg:flex-row gap-6 mb-12 items-start">
          {/* Left Section: Placeholder */}
          {/* <div className="flex-1 card min-h-full max-w-32">
            <p className="text-sm text-muted-foreground">Placeholder section</p>
          </div> */}

          {/* Middle Column: Balance and Actions */}
          <div className="flex flex-col gap-6 flex-3">
            {/* Balance Section */}
            <div className="flex flex-col gap-8 flex-1">
              {/* Unified Balance Card */}
              <div className="card bg-muted/50 card-xl card-shadow-xs">
                <div className="flex flex-col gap-6">
                  {/* Transparent Balance */}
                  <div className="border p-5 rounded-sm bg-foreground/2">
                    <div className="flex items-center gap-2 justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider bg-foreground/10 p-2 rounded-sm">Transparent</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {/* Shield Button */}
                        <Button
                          variant="ghost"
                          className={cn(
                            "h-7 px-3 text-xs text-accent-foreground gap-1.5 border-none bg-accent/40 hover:bg-accent/30",
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
                          <Shield className="h-3.5 w-3.5" />
                          Shield Now
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <img
                        src="/assets/logos/usdc-logo.svg"
                        alt="USDC"
                        className="h-6 w-6"
                      />
                      <p className="text-2xl font-medium">{displayTransparentBalance} <span className="text-sm font-semibold text-muted-foreground">USDC</span></p>
                      {hasTransparentError && (
                        <Tooltip content="Could not query transparent balance from chain" side="top">
                          <AlertCircle className="h-4 w-4 text-error" aria-label="Transparent balance error" />
                        </Tooltip>
                      )}
                    </div>
                  </div>

                  {/* Shielded Balance */}
                  <div className="border p-5 rounded-sm bg-primary/5">
                    <div className="flex items-center gap-2 justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-primary uppercase tracking-wider bg-primary/10 p-2 rounded-sm">Shielded</span>
                      </div>
                      <div className="flex items-center gap-2">
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
                          Sync
                        </Button>
                      ) : shieldedState.isSyncing ? (
                        <Button
                          variant="ghost"
                          className="h-7 px-3 text-xs gap-1.5 border border-border bg-transparent"
                          disabled
                        >
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          Syncing
                        </Button>
                      ) : null}
                      {showRefreshIndicator && (
                          <Tooltip content={`Last refreshed ${timeAgoText}`} side="top">
                            <div className={`h-2 w-2 rounded-full ${refreshIndicatorColor}`} aria-label={`Last refreshed ${timeAgoText}`} />
                          </Tooltip>
                        )}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <img
                        src="/assets/logos/usdc-logo.svg"
                        alt="USDC"
                        className="h-6 w-6"
                      />
                      <p className="text-2xl font-medium text-primary">{displayShieldedBalance} <span className="text-sm font-semibold text-muted-foreground">USDC</span></p>
                      {isShieldedBalanceLoading && (
                        <Loader2 className="h-4 w-4 animate-spin text-info" aria-label="Loading shielded balance" />
                      )}
                      {hasShieldedError && (
                        <Tooltip content="Could not query shielded balances from chain" side="top">
                          <AlertCircle className="h-4 w-4 text-error" aria-label="Shielded balance error" />
                        </Tooltip>
                      )}
                    </div>
                    <div className="mt-4">
                      <ShieldedSyncProgress compact />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Action Steps Section */}
            <div className="flex flex-col rounded-lg bg-card flex-2">
              {/* Deposit Button */}
              <Link
                to="/deposit"
                className="group flex items-center gap-4 p-8 rounded-t-lg rounded-b-none bg-card hover:bg-muted transition-colors"
              >
                <span className="flex justify-center items-center mr-4 text-md bg-muted-foreground/10 w-8 h-8 rounded-full font-semibold text-muted-foreground group-hover:text-foreground transition-colors">1</span>
                <ArrowDownLeft className="h-5 w-5 text-foreground group-hover:text-primary flex-shrink-0 transition-colors" />
                <div className="flex flex-col gap-0.5 flex-1">
                  <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">Deposit</p>
                  <p className="text-xs text-muted-foreground group-hover:text-foreground">Add transparent USDC</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary flex-shrink-0 transition-colors" />
              </Link>

              {/* Shield Button */}
              <button
                className={cn(
                  "flex items-center gap-4 p-8 rounded-none bg-card hover:bg-muted transition-colors text-left w-full",
                  "group",
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
                <span className="flex justify-center items-center mr-4 text-md bg-muted-foreground/10 w-8 h-8 rounded-full font-semibold text-muted-foreground group-hover:text-foreground transition-colors">2</span>
                <Shield className="h-5 w-5 text-foreground group-hover:text-primary flex-shrink-0 transition-colors" />
                <div className="flex flex-col gap-0.5 flex-1">
                  <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">Shield</p>
                  <p className="text-xs text-muted-foreground group-hover:text-foreground">Move USDC to your shielded balance</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary flex-shrink-0 transition-colors" />
              </button>

              {/* Send Button */}
              <Link
                to={hasShieldedBalance ? "/send" : "#"}
                className={cn(
                  "group flex items-center gap-4 p-8 rounded-t-none rounded-b-lg bg-card hover:bg-muted transition-colors",
                  !hasShieldedBalance && "opacity-50 cursor-not-allowed"
                )}
                onClick={(e) => {
                  if (!hasShieldedBalance) e.preventDefault()
                }}
              >
                <span className="flex justify-center items-center mr-4 text-md bg-muted-foreground/10 w-8 h-8 rounded-full font-semibold text-muted-foreground group-hover:text-foreground transition-colors">3</span>
                <Send className="h-5 w-5 text-foreground group-hover:text-primary flex-shrink-0 transition-colors" />
                <div className="flex flex-col gap-0.5 flex-1">
                  <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">Send</p>
                  <p className="text-xs text-muted-foreground group-hover:text-foreground">Transfer privately cross-chain</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary flex-shrink-0 transition-colors" />
              </Link>
            </div>
          </div>

          {/* Transaction Activity Box */}
          <div className="flex-5 card">
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
                hideActions={true}
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
                hideActions={true}
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
