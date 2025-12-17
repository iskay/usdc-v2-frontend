import { useState, useCallback } from 'react'
import { ArrowDownLeft, Send } from 'lucide-react'
import { RequireNamadaConnection } from '@/components/wallet/RequireNamadaConnection'
import { ShieldingModal } from '@/components/shielded/ShieldingModal'
import { useBalance } from '@/hooks/useBalance'
import { useShieldedSync } from '@/hooks/useShieldedSync'
import { useAtomValue } from 'jotai'
import { isAnyTransactionActiveAtom, txUiAtom } from '@/atoms/txUiAtom'
import { useTimeAgo } from '@/hooks/useTimeAgo'
import { useSyncIconState } from '@/hooks/useSyncIconState'
import { useTransactionQueryParam } from '@/hooks/useTransactionQueryParam'
import { useTransactionCompletionMonitor } from '@/hooks/useTransactionCompletionMonitor'
import { useBalanceDisplay } from '@/hooks/useBalanceDisplay'
import { BalanceCard } from '@/components/dashboard/BalanceCard'
import { ShieldButton } from '@/components/dashboard/ShieldButton'
import { ActionStepButton } from '@/components/dashboard/ActionStepButton'
import { RecentActivitySection } from '@/components/dashboard/RecentActivitySection'

export function Dashboard() {
  const { state: balanceState } = useBalance()
  const { state: shieldedState, startSync, isReady } = useShieldedSync()
  const isAnyTxActive = useAtomValue(isAnyTransactionActiveAtom)
  const txUiState = useAtomValue(txUiAtom)
  const [isShieldingModalOpen, setIsShieldingModalOpen] = useState(false)
  const [openModalTxId, setOpenModalTxId] = useState<string | null>(null)
  const [historyReloadTrigger, setHistoryReloadTrigger] = useState(0)

  // Use custom hooks
  const balanceDisplay = useBalanceDisplay({
    balanceState,
    shieldedState,
  })
  const currentTimestamp = balanceState.namada.shieldedLastUpdated
  const timeAgoText = useTimeAgo(currentTimestamp)
  const syncIconState = useSyncIconState({
    isSyncing: shieldedState.isSyncing,
    status: shieldedState.status,
  })

  // Handle transaction query parameter
  useTransactionQueryParam(
    useCallback((txId: string) => {
      setOpenModalTxId(txId)
    }, []),
  )

  // Monitor transaction completion
  useTransactionCompletionMonitor({
    openModalTxId,
    onTransactionCompleted: useCallback(() => {
      setHistoryReloadTrigger(prev => prev + 1)
    }, []),
  })

  // Calculate refresh indicator state
  const showRefreshIndicator =
    !balanceDisplay.hasShieldedError &&
    !balanceDisplay.isShieldedBalanceLoading &&
    currentTimestamp &&
    timeAgoText
  const timeSinceRefresh = currentTimestamp ? Date.now() - currentTimestamp : null
  const isRecentRefresh = timeSinceRefresh !== null && timeSinceRefresh < 60000 // Less than 1 minute
  const refreshIndicatorColor = isRecentRefresh ? 'bg-success' : 'bg-warning'

  // Shield button handlers
  const handleShieldClick = useCallback(() => {
    if (!isAnyTxActive) {
      setIsShieldingModalOpen(true)
    }
  }, [isAnyTxActive])

  const shieldButtonTitle =
    isAnyTxActive
      ? `Please wait for the current ${txUiState.transactionType || 'transaction'} to complete`
      : !balanceDisplay.hasTransparentBalance
        ? 'No transparent balance to shield'
        : 'Shield USDC'

  return (
    <RequireNamadaConnection>
      <div className="flex flex-col gap-6 p-12 mx-auto w-full container">

        {/* Balance and Actions Section + Recent Activity Side by Side */}
        <div className="flex flex-col lg:flex-row gap-6 mb-12 items-start">

          {/* Middle Column: Balance and Actions */}
          <div className="flex flex-col gap-6 flex-3">
            {/* Balance Section */}
            <div className="flex flex-col gap-8 flex-1">
              {/* Unified Balance Card */}
              <div className="card bg-muted/50 card-xl card-shadow-xs">
                <div className="flex flex-col gap-6">
                  {/* Transparent Balance */}
                  <BalanceCard
                    type="transparent"
                    balance={balanceDisplay.displayTransparentBalance}
                    hasError={balanceDisplay.hasTransparentError}
                    errorMessage="Could not query transparent balance from chain"
                    shieldButton={{
                      disabled: isAnyTxActive || balanceDisplay.isShieldedBalanceLoading || !balanceDisplay.hasTransparentBalance,
                      loading: balanceDisplay.isShieldedBalanceLoading,
                      onClick: handleShieldClick,
                      title: shieldButtonTitle,
                    }}
                  />

                  {/* Shielded Balance */}
                  <BalanceCard
                    type="shielded"
                    balance={balanceDisplay.displayShieldedBalance}
                    hasError={balanceDisplay.hasShieldedError}
                    isLoading={balanceDisplay.isShieldedBalanceLoading}
                    errorMessage="Could not query shielded balances from chain"
                    syncButton={{
                      syncIconState,
                      isReady,
                      isSyncing: shieldedState.isSyncing,
                      hasError: shieldedState.status === 'error' || balanceDisplay.hasShieldedError,
                      onClick: startSync,
                    }}
                    refreshIndicator={
                      showRefreshIndicator
                        ? {
                            show: true,
                            timeAgoText,
                            color: refreshIndicatorColor,
                          }
                        : undefined
                    }
                    showSyncProgress={true}
                  />
                </div>
              </div>
            </div>

            {/* Action Steps Section */}
            <div className="flex flex-col rounded-lg bg-card flex-2">
              <ActionStepButton
                stepNumber={1}
                icon={ArrowDownLeft}
                title="Deposit"
                description="Add transparent USDC"
                to="/deposit"
                borderRadius={{ top: 'rounded-t-lg rounded-b-none' }}
              />

              <ShieldButton
                variant="action-step"
                disabled={isAnyTxActive || balanceDisplay.isShieldedBalanceLoading || !balanceDisplay.hasTransparentBalance}
                loading={balanceDisplay.isShieldedBalanceLoading}
                onClick={handleShieldClick}
                title={shieldButtonTitle}
              />

              <ActionStepButton
                stepNumber={3}
                icon={Send}
                title="Send"
                description="Transfer privately cross-chain"
                to={balanceDisplay.hasShieldedBalance ? "/send" : "#"}
                disabled={!balanceDisplay.hasShieldedBalance}
                borderRadius={{ bottom: 'rounded-t-none rounded-b-lg' }}
              />
            </div>
          </div>

          {/* Transaction Activity Box */}
          <RecentActivitySection
            openModalTxId={openModalTxId}
            onModalOpenChange={setOpenModalTxId}
            reloadTrigger={historyReloadTrigger}
          />
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
