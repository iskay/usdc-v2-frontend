import { useState, useEffect, useRef, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSetAtom } from 'jotai'
import { DollarSign, Loader2 } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { ChainSelect } from '@/components/common/ChainSelect'
import { DepositConfirmationModal } from '@/components/deposit/DepositConfirmationModal'
import { useWallet } from '@/hooks/useWallet'
import { useBalance } from '@/hooks/useBalance'
import { useToast } from '@/hooks/useToast'
import { RequireMetaMaskConnection } from '@/components/wallet/RequireMetaMaskConnection'
import { validateDepositForm } from '@/utils/depositValidation'
import { useDepositFeeEstimate } from '@/hooks/useDepositFeeEstimate'
import {
  buildDepositTransaction,
  signDepositTransaction,
  broadcastDepositTransaction,
  saveDepositTransaction,
  postDepositToBackend,
  type DepositTransactionDetails,
} from '@/services/deposit/depositService'
import { useTxTracker } from '@/hooks/useTxTracker'
import { fetchEvmChainsConfig } from '@/services/config/chainConfigService'
import { preferredChainKeyAtom } from '@/atoms/appAtom'

export function Deposit() {
  const navigate = useNavigate()
  const { upsertTransaction } = useTxTracker()
  const { notify } = useToast()
  const { state: walletState } = useWallet()
  const { state: balanceState, refresh, sync: balanceSync } = useBalance()
  const setPreferredChainKey = useSetAtom(preferredChainKeyAtom)

  // Form state
  const [amount, setAmount] = useState('')
  const [toAddress, setToAddress] = useState('')
  const [selectedChain, setSelectedChain] = useState<string | undefined>(undefined)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showConfirmationModal, setShowConfirmationModal] = useState(false)

  // Get EVM address from wallet state
  const evmAddress = walletState.metaMask.account

  // Use deposit fee estimation hook
  const { state: feeEstimateState } = useDepositFeeEstimate(
    selectedChain,
    amount,
    toAddress,
    evmAddress,
  )

  // Get fee info from hook state
  const feeInfo = feeEstimateState.feeInfo
  const isEstimatingFee = feeEstimateState.isLoading

  // Format fee for display (hybrid: native token + USD estimate)
  // The service already formats the amount, so we just add the symbol and USD estimate
  // Use 4 decimal places for better precision
  const estimatedFee = feeInfo
    ? feeInfo.totalUsd !== undefined
      ? `${feeInfo.totalNative} ${feeInfo.nativeSymbol} (~$${feeInfo.totalUsd.toFixed(4)})`
      : `${feeInfo.totalNative} ${feeInfo.nativeSymbol}`
    : '--'

  // Track last refresh values to prevent unnecessary refreshes
  const lastRefreshRef = useRef<{
    account?: string
    chainId?: number
  }>({})

  // Determine if EVM balance is currently being fetched
  const isEvmBalanceLoading =
    balanceSync.status === 'refreshing' && walletState.metaMask.isConnected

  // Get live EVM balance from balance state
  // Show '--' when balance is '--' or when loading, otherwise show actual balance
  const availableBalance =
    balanceState.evm.usdc !== '--' ? balanceState.evm.usdc : '--'

  // Store refresh function in ref to avoid dependency issues
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  // Refresh balance when wallet connects or chain changes (only if values actually changed)
  useEffect(() => {
    const currentAccount = walletState.metaMask.account
    const currentChainId = walletState.metaMask.chainId
    const lastAccount = lastRefreshRef.current.account
    const lastChainId = lastRefreshRef.current.chainId

    // Only refresh if account or chainId actually changed
    if (
      walletState.metaMask.isConnected &&
      currentAccount &&
      (currentAccount !== lastAccount || currentChainId !== lastChainId)
    ) {
      lastRefreshRef.current = {
        account: currentAccount,
        chainId: currentChainId,
      }
      // Balance service will determine chain key from chainId automatically
      void refreshRef.current()
    }
  }, [
    walletState.metaMask.isConnected,
    walletState.metaMask.account,
    walletState.metaMask.chainId,
  ])

  // Load default chain from config
  useEffect(() => {
    let mounted = true

    async function loadDefaultChain() {
      try {
        const config = await fetchEvmChainsConfig()
        if (mounted && config.defaults?.selectedChainKey) {
          setSelectedChain(config.defaults.selectedChainKey)
        }
      } catch (error) {
        console.error('[Deposit] Failed to load default chain:', error)
      }
    }

    void loadDefaultChain()

    return () => {
      mounted = false
    }
  }, [])


  // Get chain name for display
  const [chainName, setChainName] = useState('')
  useEffect(() => {
    let mounted = true

    async function loadChainName() {
      try {
        const config = await fetchEvmChainsConfig()
        if (mounted) {
          const chain = config.chains.find((c) => c.key === selectedChain)
          setChainName(chain?.name ?? selectedChain)
        }
      } catch (error) {
        console.error('[Deposit] Failed to load chain name:', error)
        if (mounted) {
          setChainName(selectedChain)
        }
      }
    }

    void loadChainName()

    return () => {
      mounted = false
    }
  }, [selectedChain])

  // Set preferred chain key when selectedChain changes (for polling to use)
  useEffect(() => {
    if (selectedChain) {
      setPreferredChainKey(selectedChain)
    }
  }, [selectedChain, setPreferredChainKey])

  // Refresh balance when selectedChain changes (for dropdown selection)
  useEffect(() => {
    if (walletState.metaMask.isConnected && walletState.metaMask.account && selectedChain) {
      // Refresh balance with the selected chain key
      void refreshRef.current({ chainKey: selectedChain })
    }
  }, [selectedChain, walletState.metaMask.isConnected, walletState.metaMask.account])

  // Don't render form until chain is loaded
  if (!selectedChain) {
    return (
      <RequireMetaMaskConnection message="Please connect your MetaMask wallet to deposit USDC. EVM deposits require a connected wallet.">
        <div className="flex flex-col gap-6 p-24">
          <div className="flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </div>
      </RequireMetaMaskConnection>
    )
  }

  // Form validation - for now, use 0 for fee validation since native token fees don't affect USDC amount
  // TODO: In Phase 2, we might want to convert native token fees to USD for validation
  const feeValueForValidation = '0.00' // Native token fees don't affect USDC amount validation
  const validation = validateDepositForm(amount, availableBalance, feeValueForValidation, toAddress)

  // Calculate total - USDC amount + fee USD (if available) + Noble registration fee
  const amountNum = parseFloat(amount || '0')
  const feeUsd = feeInfo?.totalUsd ?? 0
  const nobleRegUsd = feeInfo?.nobleRegUsd ?? 0
  const totalUsd = amountNum + feeUsd + nobleRegUsd
  const total = totalUsd.toFixed(4)

  // Handle form submission
  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    // Validate form
    if (!validation.isValid) {
      if (validation.amountError) {
        notify({ title: 'Invalid Amount', description: validation.amountError, level: 'error' })
      }
      if (validation.addressError) {
        notify({ title: 'Invalid Address', description: validation.addressError, level: 'error' })
      }
      return
    }

    // Show confirmation modal
    setShowConfirmationModal(true)
  }

  // Handle confirmation and submit transaction
  async function handleConfirmDeposit(): Promise<void> {
    setShowConfirmationModal(false)
    setIsSubmitting(true)

    try {
      // Build transaction details
      const transactionDetails: DepositTransactionDetails = {
        amount,
        fee: estimatedFee,
        total,
        destinationAddress: toAddress,
        chainName,
      }

      // Build transaction
      notify({ title: 'Building transaction...', level: 'info' })
      const tx = await buildDepositTransaction({
        amount,
        destinationAddress: toAddress,
        sourceChain: selectedChain,
      })

      // Sign transaction
      notify({ title: 'Signing transaction...', level: 'info' })
      const signedTx = await signDepositTransaction(tx)

      // Broadcast transaction
      notify({ title: 'Broadcasting transaction...', level: 'info' })
      const txHash = await broadcastDepositTransaction(signedTx)

      // Update transaction with hash
      const txWithHash = {
            ...signedTx,
            hash: txHash,
        status: 'broadcasted' as const,
      }

      // Post to backend (pass transaction for additional metadata)
      const flowId = await postDepositToBackend(txHash, transactionDetails, txWithHash)

      // Save transaction to unified storage with deposit details and flowId
      const savedTx = await saveDepositTransaction(txWithHash, transactionDetails, flowId)

      // Also update in-memory state for immediate UI updates
      upsertTransaction(savedTx)

      // Show success toast
      notify({
        title: 'Deposit Submitted',
        description: `Transaction ${txHash.slice(0, 10)}... submitted successfully`,
        level: 'success',
      })

      // Navigate to Dashboard
      navigate('/dashboard')
    } catch (error) {
      console.error('[Deposit] Deposit submission failed:', error)
      const message = error instanceof Error ? error.message : 'Failed to submit deposit'
      notify({
        title: 'Deposit Failed',
        description: message,
        level: 'error',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  // Handle Auto Fill for Namada address
  function handleAutoFill() {
    // Get Namada address from wallet state
    const namadaAddress = walletState.namada.account
    if (namadaAddress) {
      setToAddress(namadaAddress)
      notify({
        title: 'Address Auto-filled',
        description: 'Namada address populated from connected wallet',
        level: 'info',
      })
    } else {
      notify({
        title: 'Namada Not Connected',
        description: 'Please connect your Namada Keychain to use Auto Fill',
        level: 'error',
      })
    }
  }

  // Transaction details for confirmation modal
  // The service already formats the amounts, so we just add the symbol and USD estimate
  // Use 4 decimal places for better precision
  const transactionDetails: DepositTransactionDetails = {
    amount,
    fee: feeInfo
      ? feeInfo.totalUsd !== undefined
        ? `${feeInfo.totalNative} ${feeInfo.nativeSymbol} (~$${feeInfo.totalUsd.toFixed(4)})`
        : `${feeInfo.totalNative} ${feeInfo.nativeSymbol}`
      : '--',
    total,
    destinationAddress: toAddress,
    chainName,
    feeBreakdown: feeInfo
      ? {
          approveNative: feeInfo.approveNative,
          burnNative: feeInfo.burnNative,
          totalNative: feeInfo.totalNative,
          nativeSymbol: feeInfo.nativeSymbol,
          approvalNeeded: feeInfo.approvalNeeded,
          approveUsd: feeInfo.approveUsd,
          burnUsd: feeInfo.burnUsd,
          totalUsd: feeInfo.totalUsd,
          nobleRegUsd: feeInfo.nobleRegUsd,
        }
      : undefined,
    isLoadingFee: isEstimatingFee,
  }

  return (
    <RequireMetaMaskConnection message="Please connect your MetaMask wallet to deposit USDC. EVM deposits require a connected wallet.">
      <div className="flex flex-col gap-6 p-24">
        {/* Amount Display Section */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-500">
            <DollarSign className="h-5 w-5 text-white" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold">$</span>
            <input
              type="text"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-32 border-none bg-transparent p-0 text-3xl font-bold focus:outline-none focus:ring-0"
              placeholder="0.00"
              inputMode="decimal"
              disabled={isSubmitting}
            />
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              of ${availableBalance}
              {isEvmBalanceLoading && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              )}
            </span>
          </div>
        </div>

        {/* Validation error for amount */}
        {validation.amountError && (
          <div className="text-sm text-destructive">{validation.amountError}</div>
        )}

        <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
          {/* To Namada Address Section */}
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <label className="text-sm font-medium text-muted-foreground">To Namada address</label>
              <button
                type="button"
                onClick={handleAutoFill}
                disabled={!walletState.namada.isConnected || isSubmitting}
                className={`text-sm text-muted-foreground hover:text-foreground ${
                  !walletState.namada.isConnected || isSubmitting
                    ? 'opacity-50 cursor-not-allowed'
                    : ''
                }`}
              >
                Auto Fill
              </button>
            </div>
            <input
              type="text"
              value={toAddress}
              onChange={(e) => setToAddress(e.target.value)}
              className="rounded-lg border border-input bg-background px-4 py-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="tnam..."
              disabled={isSubmitting}
            />
            {/* Validation error for address */}
            {validation.addressError && (
              <div className="text-sm text-destructive">{validation.addressError}</div>
            )}
          </div>

          {/* Chain Select Component */}
          <ChainSelect
            value={selectedChain}
            onChange={setSelectedChain}
            disabled={isSubmitting}
            showEstimatedTime={true}
            timeType="deposit"
          />

          {/* Fee and Total Summary */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Fee</span>
              {isEstimatingFee ? (
                <div className="flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Estimating...</span>
                </div>
              ) : feeInfo ? (
                <span className="text-sm font-medium">{estimatedFee}</span>
              ) : (
                <span className="text-sm text-muted-foreground">--</span>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-border pt-2">
              <span className="text-sm font-medium">Total</span>
              <span className="text-sm font-semibold">${total}</span>
            </div>
          </div>

          {/* Action Button */}
          <Button
            type="submit"
            variant="primary"
            className="w-full py-6 text-lg"
            disabled={!validation.isValid || isSubmitting}
          >
            {isSubmitting ? 'Processing...' : 'Deposit now'}
          </Button>
        </form>

        {/* Confirmation Modal */}
        <DepositConfirmationModal
          open={showConfirmationModal}
          onClose={() => setShowConfirmationModal(false)}
          onConfirm={handleConfirmDeposit}
          transactionDetails={transactionDetails}
        />
      </div>
    </RequireMetaMaskConnection>
  )
}
