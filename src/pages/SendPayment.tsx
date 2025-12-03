import { useState, useEffect, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Shield, ArrowRight, AlertCircle } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { BackToHome } from '@/components/common/BackToHome'
import { RequireNamadaConnection } from '@/components/wallet/RequireNamadaConnection'
import { ChainSelect } from '@/components/common/ChainSelect'
import { PaymentConfirmationModal } from '@/components/payment/PaymentConfirmationModal'
import { type TransactionPhase } from '@/components/tx/ProgressStepper'
import { TransactionSuccessOverlay } from '@/components/tx/TransactionSuccessOverlay'
import { FormLockOverlay } from '@/components/tx/FormLockOverlay'
import { useBalance } from '@/hooks/useBalance'
import { useShieldedSync } from '@/hooks/useShieldedSync'
import { useWallet } from '@/hooks/useWallet'
import { useToast } from '@/hooks/useToast'
import { useAtomValue } from 'jotai'
import { balanceSyncAtom } from '@/atoms/balanceAtom'
import { validatePaymentForm, handleAmountInputChange, handleEvmAddressInputChange } from '@/services/validation'
import {
  buildTransactionSuccessToast,
  buildTransactionErrorToast,
  buildTransactionStatusToast,
  buildValidationErrorToast,
  buildCopySuccessToast,
} from '@/utils/toastHelpers'
import { usePaymentFeeEstimate } from '@/hooks/usePaymentFeeEstimate'
import {
  buildPaymentTransaction,
  signPaymentTransaction,
  broadcastPaymentTransaction,
  savePaymentTransaction,
  type PaymentTransactionDetails,
} from '@/services/payment/paymentService'
import { useTxTracker } from '@/hooks/useTxTracker'
import { transactionStorageService, type StoredTransaction } from '@/services/tx/transactionStorageService'
import { fetchEvmChainsConfig } from '@/services/config/chainConfigService'
import { triggerShieldedBalanceRefresh } from '@/services/balance/shieldedBalanceService'
import { NAMADA_CHAIN_ID } from '@/config/constants'
import { getNamadaTxExplorerUrl } from '@/utils/explorerUtils'
import { sanitizeError } from '@/utils/errorSanitizer'
import { cn } from '@/lib/utils'

export function SendPayment() {
  const navigate = useNavigate()
  const { upsertTransaction } = useTxTracker({ enablePolling: false })
  const { notify, updateToast, dismissToast } = useToast()
  const { state: walletState } = useWallet()

  // Form state
  const [amount, setAmount] = useState('')
  const [toAddress, setToAddress] = useState('')
  const [selectedChain, setSelectedChain] = useState<string | undefined>(undefined)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showConfirmationModal, setShowConfirmationModal] = useState(false)
  
  // Transaction phase tracking
  const [currentPhase, setCurrentPhase] = useState<TransactionPhase>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [explorerUrl, setExplorerUrl] = useState<string | undefined>(undefined)
  const [errorState, setErrorState] = useState<{ message: string } | null>(null)
  const [showSuccessState, setShowSuccessState] = useState(false)

  // Get live shielded balance from balance state
  const { state: balanceState } = useBalance()
  const { state: shieldedState } = useShieldedSync()
  const balanceSyncState = useAtomValue(balanceSyncAtom)

  const shieldedBalance = balanceState.namada.usdcShielded || '0.00'
  const isShieldedBalanceLoading =
    shieldedState.isSyncing || balanceSyncState.shieldedStatus === 'calculating'

  // Get Namada addresses from wallet state
  const transparentAddress = walletState.namada.account
  const shieldedAddress = walletState.namada.shieldedAccount

  // Use payment fee estimation hook
  const { state: feeEstimateState } = usePaymentFeeEstimate(
    amount,
    transparentAddress,
    shieldedAddress,
  )

  // Get fee info from hook state
  const feeInfo = feeEstimateState.feeInfo
  const isEstimatingFee = feeEstimateState.isLoading

  // Format fee for display
  const estimatedFee = feeInfo
    ? feeInfo.feeToken === 'USDC'
      ? `$${parseFloat(feeInfo.feeAmount).toFixed(2)}`
      : `${parseFloat(feeInfo.feeAmount).toFixed(6)} NAM`
    : '0.00'

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
        console.error('[SendPayment] Failed to load default chain:', error)
      }
    }

    void loadDefaultChain()

    return () => {
      mounted = false
    }
  }, [])

  // Trigger shielded sync on page load (non-blocking, happens in background)
  useEffect(() => {
    if (walletState.namada.isConnected && shieldedAddress) {
      void triggerShieldedBalanceRefresh({ chainId: NAMADA_CHAIN_ID }).catch((error) => {
        // Don't show error to user - sync will happen again before transaction
        console.debug('[SendPayment] Background sync failed:', error)
      })
    }
  }, [walletState.namada.isConnected, shieldedAddress])


  // Get chain name for display
  const [chainName, setChainName] = useState('')
  useEffect(() => {
    let mounted = true

    async function loadChainName() {
      try {
        const config = await fetchEvmChainsConfig()
        if (mounted) {
          const chain = config.chains.find((c) => c.key === selectedChain)
          setChainName(chain?.name ?? selectedChain ?? '')
        }
      } catch (error) {
        console.error('[SendPayment] Failed to load chain name:', error)
        if (mounted) {
          setChainName(selectedChain ?? '')
        }
      }
    }

    void loadChainName()

    return () => {
      mounted = false
    }
  }, [selectedChain])

  // Don't render form until chain is loaded
  if (!selectedChain) {
    return (
      <RequireNamadaConnection message="Please connect your Namada Keychain to send payments. Shielded payments require a connected wallet.">
        <div className="flex flex-col gap-6 p-24">
          <div className="flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </div>
      </RequireNamadaConnection>
    )
  }

  // Form validation - use numeric fee value for validation
  const feeValueForValidation = feeInfo
    ? feeInfo.feeToken === 'USDC'
      ? parseFloat(feeInfo.feeAmount).toFixed(2)
      : '0.00' // NAM fees don't affect USDC amount validation
    : '0.00'
  const validation = validatePaymentForm(amount, shieldedBalance, feeValueForValidation, toAddress)
  
  // Calculate total - only add fee if it's USDC
  const amountNum = parseFloat(amount || '0')
  const feeNum = feeInfo && feeInfo.feeToken === 'USDC' ? parseFloat(feeInfo.feeAmount) : 0
  const total = (amountNum + feeNum).toFixed(2)

  // Handle form submission
  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    // Validate form
    if (!validation.isValid) {
      if (validation.amountError) {
        notify(buildValidationErrorToast('Amount', validation.amountError))
      }
      if (validation.addressError) {
        notify(buildValidationErrorToast('Address', validation.addressError))
      }
      return
    }

    // Show confirmation modal
    setShowConfirmationModal(true)
  }

  // Handle Auto Fill for EVM address
  function handleAutoFill() {
    // Get EVM address from MetaMask wallet state
    const evmAddress = walletState.metaMask.account
    if (evmAddress) {
      setToAddress(evmAddress)
      notify({
        title: 'Address Auto-filled',
        description: 'EVM address populated from connected MetaMask wallet',
        level: 'info',
        icon: <AlertCircle className="h-5 w-5" />,
      })
    } else {
      notify({
        title: 'MetaMask Not Connected',
        description: 'Please connect your MetaMask wallet to use Auto Fill',
        level: 'error',
      })
    }
  }

  // Handle confirmation and submit transaction
  async function handleConfirmPayment(): Promise<void> {
    setShowConfirmationModal(false)
    setIsSubmitting(true)
    setCurrentPhase('building')
    setErrorState(null)
    setTxHash(null)
    setExplorerUrl(undefined)
    setShowSuccessState(false)

    // Track transaction state for error handling
    let tx: Awaited<ReturnType<typeof buildPaymentTransaction>> | undefined
    let signedTx: Awaited<ReturnType<typeof signPaymentTransaction>> | undefined
    let currentTx: StoredTransaction | undefined

    // Use a consistent toast ID for transaction status updates (moved outside try so it's accessible in catch)
    const txToastId = `payment-tx-${Date.now()}`

    try {
      // Build transaction details
      const transactionDetails: PaymentTransactionDetails = {
        amount,
        fee: estimatedFee,
        total,
        destinationAddress: toAddress,
        chainName,
      }

      if (!transparentAddress) {
        throw new Error('Namada transparent address not found. Please connect your Namada Keychain.')
      }

      // Show sync status if sync is happening
      if (shieldedState.isSyncing) {
        notify({
          title: 'Syncing shielded balance...',
          description: 'Please wait while we update your shielded context',
          level: 'info',
        })
      }

      // Build transaction (this will ensure sync completes before building)
      notify(buildTransactionStatusToast('building', 'send', txToastId))
      tx = await buildPaymentTransaction({
        amount,
        destinationAddress: toAddress,
        destinationChain: selectedChain!, // Safe: guarded by check at line 123
        transparentAddress,
        shieldedAddress,
      })

      // Save transaction immediately after build (for error tracking)
      currentTx = {
        ...tx,
        paymentDetails: transactionDetails,
        updatedAt: Date.now(),
      }
      transactionStorageService.saveTransaction(currentTx)
      upsertTransaction(tx)

      // Sign transaction (no-op, actual signing happens during broadcast)
      setCurrentPhase('signing')
      updateToast(txToastId, buildTransactionStatusToast('signing', 'send'))
      signedTx = await signPaymentTransaction(tx)
      
      // Update status to signing
      currentTx = {
        ...currentTx,
        ...signedTx,
        status: 'signing',
        updatedAt: Date.now(),
      }
      transactionStorageService.saveTransaction(currentTx)
      upsertTransaction(signedTx)

      // Broadcast transaction (signing popup appears here, so keep showing "Signing transaction...")
      // Update status to submitting after signing completes
      currentTx = {
        ...currentTx,
        status: 'submitting',
        updatedAt: Date.now(),
      }
      transactionStorageService.saveTransaction(currentTx)
      
      const broadcastResult = await broadcastPaymentTransaction(signedTx, {
        onSigningComplete: () => {
          // Phase 3: Submitting (only after signing is complete)
          setCurrentPhase('submitting')
          updateToast(txToastId, buildTransactionStatusToast('submitting', 'send'))
        },
      })
      const txHash = broadcastResult.hash
      const blockHeight = broadcastResult.blockHeight

      // Update transaction with hash and block height
      const txWithHash = {
        ...signedTx,
        hash: txHash,
        blockHeight,
        status: 'broadcasted' as const,
      }

      // Save transaction to unified storage with payment details
      // Frontend polling handles all tracking (no backend registration needed)
      const savedTx = await savePaymentTransaction(txWithHash, transactionDetails)

      // Also update in-memory state for immediate UI updates
      upsertTransaction(savedTx)

      // Update the existing loading toast to success toast
      const successToast = buildTransactionSuccessToast(savedTx, {
        onViewTransaction: (id) => {
          navigate(`/dashboard?tx=${id}`)
        },
        onCopyHash: () => {
          notify(buildCopySuccessToast('Transaction hash'))
        },
      })
      const { id: _, ...successToastArgs } = successToast
      updateToast(txToastId, successToastArgs)

      // Set success state and fetch explorer URL
      setCurrentPhase(null)
      setTxHash(txHash)
      getNamadaTxExplorerUrl(txHash).then((url) => {
        setExplorerUrl(url)
      }).catch(() => {
        // Silently fail if explorer URL can't be fetched
      })
      setShowSuccessState(true)
    } catch (error) {
      // Dismiss the loading toast if it exists
      dismissToast(txToastId)
      
      console.error('[SendPayment] Payment submission failed:', error)
      const sanitized = sanitizeError(error)
      const message = sanitized.message
      
      // Save error transaction to storage for history tracking
      try {
        // Build transaction details for error case
        const transactionDetails: PaymentTransactionDetails = {
          amount,
          fee: estimatedFee,
          total,
          destinationAddress: toAddress,
          chainName,
        }
        
        // Use current transaction state if available, otherwise create new error transaction
        const errorTx: StoredTransaction = currentTx
          ? {
              ...currentTx,
              status: 'error',
              errorMessage: message,
              updatedAt: Date.now(),
            }
          : {
              id: tx?.id || crypto.randomUUID(),
              createdAt: tx?.createdAt || Date.now(),
              updatedAt: Date.now(),
              chain: tx?.chain || selectedChain || '',
              direction: 'send',
              status: 'error',
              errorMessage: message,
              paymentDetails: transactionDetails,
            }
        
        transactionStorageService.saveTransaction(errorTx)
        upsertTransaction(errorTx)
      } catch (saveError) {
        console.error('[SendPayment] Failed to save error transaction:', saveError)
      }
      
      // Show error toast with action to view transaction if available
      const errorTxForToast = currentTx || (tx ? { id: tx.id, direction: 'send' as const } : undefined)
      if (errorTxForToast) {
        notify(
          buildTransactionErrorToast(errorTxForToast, message, {
            onViewTransaction: (id) => {
              navigate(`/dashboard?tx=${id}`)
            },
          })
        )
      } else {
        notify({
          title: 'Payment Failed',
          description: message,
          level: 'error',
        })
      }
      
      // Set error state for enhanced error display
      setErrorState({ message })
      setCurrentPhase(null)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRetry = () => {
    setErrorState(null)
    setIsSubmitting(false)
    setCurrentPhase(null)
    setTxHash(null)
    setExplorerUrl(undefined)
    setShowSuccessState(false)
  }

  // Transaction details for confirmation modal
  const transactionDetails: PaymentTransactionDetails = {
    amount,
    fee: feeInfo
      ? feeInfo.feeToken === 'USDC'
        ? parseFloat(feeInfo.feeAmount).toFixed(2)
        : parseFloat(feeInfo.feeAmount).toFixed(6)
      : '0.00',
    feeToken: feeInfo?.feeToken,
    total,
    destinationAddress: toAddress,
    chainName,
    isLoadingFee: isEstimatingFee,
  }

  return (
    <RequireNamadaConnection message="Please connect your Namada Keychain to send payments. Shielded payments require a connected wallet.">
      {/* Success Overlay */}
      {showSuccessState && txHash && (
        <TransactionSuccessOverlay
          txHash={txHash}
          explorerUrl={explorerUrl}
          onNavigate={() => navigate('/dashboard')}
          countdownSeconds={3}
        />
      )}

      <div className="flex flex-col gap-6 p-12 max-w-[1024px] mx-auto w-full">
        <BackToHome />

        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Send Payment</h1>
          <p className="text-muted-foreground">
            Send USDC from your shielded balance to an EVM address.
          </p>
        </header>

        {/* Enhanced Error State */}
        {errorState && (
          <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-4 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-red-700 dark:text-red-400 mb-1">
                  Transaction Failed
                </h3>
                <p className="text-sm text-red-600 dark:text-red-300 mb-3">
                  {errorState.message}
                </p>
                <Button
                  variant="secondary"
                  onClick={handleRetry}
                  className="h-8 text-sm"
                >
                  Try Again
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className={cn("flex flex-col gap-6 relative", isSubmitting && "opacity-60")}>
          {/* Form Lock Overlay - covers both balance card and form */}
          <FormLockOverlay isLocked={isSubmitting} currentPhase={currentPhase} />
          
          {/* Shielded Balance Card */}
          <div className="rounded-lg border border-red-200/50 bg-gradient-to-br from-red-50/50 to-red-100/30 dark:from-red-950/20 dark:to-red-900/10 dark:border-red-800/50 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/20 dark:bg-red-600/20">
                  <Shield className="h-5 w-5 text-red-600 dark:text-red-500" />
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Available Balance</p>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-xl font-bold">{shieldedBalance} <span className="text-base font-semibold text-muted-foreground">USDC</span></p>
                    {isShieldedBalanceLoading && (
                      <Loader2 className="h-4 w-4 animate-spin text-red-500" aria-label="Loading shielded balance" />
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
          {/* Amount Input Section */}
          <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
            <label className="block text-sm font-medium text-muted-foreground mb-3">Amount</label>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-muted-foreground">$</span>
              <input
                type="text"
                value={amount}
                onChange={(e) => handleAmountInputChange(e, setAmount, 6)}
                className="flex-1 border-none bg-transparent p-0 text-3xl font-bold focus:outline-none focus:ring-0 placeholder:text-muted-foreground/30"
                placeholder="0.00"
                inputMode="decimal"
                disabled={isSubmitting}
              />
              <span className="text-sm text-muted-foreground">USDC</span>
            </div>
            {/* Validation error for amount */}
            {validation.amountError && amount.trim() !== '' && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span className="flex-1">{validation.amountError}</span>
              </div>
            )}
          </div>

          {/* To Address Section */}
          <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
            <div className="flex items-baseline justify-between mb-3">
              <label className="text-sm font-medium text-muted-foreground">Recipient Address</label>
              <button
                type="button"
                onClick={handleAutoFill}
                disabled={!walletState.metaMask.isConnected || isSubmitting}
                className={`text-sm font-medium text-primary hover:text-primary/80 transition-colors ${
                  !walletState.metaMask.isConnected || isSubmitting
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
              onChange={(e) => handleEvmAddressInputChange(e, setToAddress)}
              className={`w-full rounded-lg border bg-background px-4 py-3 text-sm font-mono shadow-sm focus-visible:outline-none focus-visible:ring-2 transition-colors ${
                validation.addressError && toAddress.trim() !== ''
                  ? 'border-destructive focus-visible:ring-destructive/20 focus-visible:border-destructive'
                  : 'border-input focus-visible:ring-ring focus-visible:border-ring'
              }`}
              placeholder="0x..."
              disabled={isSubmitting}
            />
            {/* Validation error for address */}
            {validation.addressError && toAddress.trim() !== '' && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span className="flex-1">{validation.addressError}</span>
              </div>
            )}
          </div>

          {/* Chain Select Component */}
          <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
            <label className="block text-sm font-medium text-muted-foreground mb-3">Destination Chain</label>
            <ChainSelect
              value={selectedChain}
              onChange={setSelectedChain}
              disabled={isSubmitting}
              showEstimatedTime={true}
              timeType="send"
            />
          </div>

          {/* Fee and Total Summary */}
          <div className="rounded-lg border border-border bg-card p-6 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Network Fee</span>
              {isEstimatingFee ? (
                <div className="flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Estimating...</span>
                </div>
              ) : feeInfo ? (
                <span className="text-sm font-semibold">
                  {feeInfo.feeToken === 'USDC'
                    ? `$${parseFloat(feeInfo.feeAmount).toFixed(2)}`
                    : `${parseFloat(feeInfo.feeAmount).toFixed(6)} NAM`}
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">--</span>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-border pt-3">
              <span className="text-base font-semibold">Total</span>
              <span className="text-xl font-bold">
                {feeInfo && feeInfo.feeToken === 'USDC' ? `$${total}` : `$${amount || '0.00'}`}
              </span>
            </div>
          </div>

          {/* Action Button */}
          <div className="space-y-1">
            <Button
              type="submit"
              variant="primary"
              className={cn(
                "w-full py-6 text-lg font-semibold gap-2 transition-all",
                isSubmitting && "animate-pulse cursor-not-allowed opacity-60",
                !validation.isValid && !isSubmitting && "opacity-50 cursor-not-allowed"
              )}
              disabled={!validation.isValid || isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span className="transition-opacity duration-200">
                    {currentPhase === 'building' && 'Building transaction...'}
                    {currentPhase === 'signing' && 'Waiting for approval...'}
                    {currentPhase === 'submitting' && 'Submitting transaction...'}
                    {!currentPhase && 'Processing...'}
                  </span>
                </>
              ) : (
                <>
                  <ArrowRight className="h-5 w-5" />
                  Send Payment
                </>
              )}
            </Button>
            {!validation.isValid && !isSubmitting && (
              <p className="text-xs text-muted-foreground text-center">
                {validation.amountError || validation.addressError || 'Please fill in all required fields'}
              </p>
            )}
          </div>
          </form>
          <div className='min-h-12' />
        </div>

        {/* Confirmation Modal */}
        <PaymentConfirmationModal
          open={showConfirmationModal}
          onClose={() => setShowConfirmationModal(false)}
          onConfirm={handleConfirmPayment}
          transactionDetails={transactionDetails}
        />

        {/* ARIA Live Region for Screen Readers */}
        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {currentPhase && (
            <span>
              {currentPhase === 'building' && 'Building transaction'}
              {currentPhase === 'signing' && 'Waiting for wallet approval'}
              {currentPhase === 'submitting' && 'Submitting transaction'}
            </span>
          )}
        </div>
      </div>
    </RequireNamadaConnection>
  )
}
