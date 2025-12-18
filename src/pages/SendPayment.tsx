import { useState, useEffect, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { RequireNamadaConnection } from '@/components/wallet/RequireNamadaConnection'
import { ChainSelect } from '@/components/common/ChainSelect'
import { PaymentConfirmationModal } from '@/components/payment/PaymentConfirmationModal'
import { TransactionDisplay } from '@/components/tx/TransactionDisplay'
import { SendFlowSteps } from '@/components/payment/SendFlowSteps'
import { SendSummaryCard } from '@/components/payment/SendSummaryCard'
import { useWallet } from '@/hooks/useWallet'
import { useToast } from '@/hooks/useToast'
import { useAtomValue, useAtom } from 'jotai'
import { validatePaymentForm } from '@/services/validation'
import { buildValidationErrorToast } from '@/utils/toastHelpers'
import { usePaymentFeeEstimate } from '@/hooks/usePaymentFeeEstimate'
import { type PaymentTransactionDetails } from '@/services/payment/paymentService'
import { triggerShieldedBalanceRefresh } from '@/services/balance/shieldedBalanceService'
import { NAMADA_CHAIN_ID } from '@/config/constants'
import { txUiAtom, isAnyTransactionActiveAtom, resetTxUiState } from '@/atoms/txUiAtom'
import { useChainSelection } from '@/hooks/useChainSelection'
import { useSendPaymentBalance } from '@/hooks/useSendPaymentBalance'
import { usePaymentTransaction } from '@/hooks/usePaymentTransaction'
import { useShieldedSync } from '@/hooks/useShieldedSync'
import { saveAddressToBook } from '@/utils/addressBookUtils'
import { TransactionErrorDisplay } from '@/components/common/TransactionErrorDisplay'
import { SendPaymentAmountInput } from '@/components/payment/SendPaymentAmountInput'
import { SendPaymentRecipientSection } from '@/components/payment/SendPaymentRecipientSection'
import { SendPaymentFeeDisplay } from '@/components/payment/SendPaymentFeeDisplay'

export function SendPayment() {
  const navigate = useNavigate()
  const { notify } = useToast()
  const { state: walletState } = useWallet()

  // Form state
  const [amount, setAmount] = useState('')
  const [toAddress, setToAddress] = useState('')
  const [recipientName, setRecipientName] = useState<string | null>(null)
  const [nameValidationError, setNameValidationError] = useState<string | null>(null)
  const [showConfirmationModal, setShowConfirmationModal] = useState(false)
  
  // State to freeze UI during navigation transition
  const [isExiting, setIsExiting] = useState(false)
  
  // Global transaction UI state
  const [txUiState, setTxUiState] = useAtom(txUiAtom)
  const isAnyTxActive = useAtomValue(isAnyTransactionActiveAtom)
  
  // Local state derived from global state for convenience
  const currentPhase = txUiState.phase
  const txHash = txUiState.txHash
  const explorerUrl = txUiState.explorerUrl
  const errorState = txUiState.errorState
  const showSuccessState = txUiState.showSuccessState

  // Custom hooks
  const { selectedChain, chainName, setSelectedChain } = useChainSelection({
    strategy: 'default',
    updatePreferred: false,
  })
  const { shieldedBalance, isShieldedBalanceLoading, hasBalanceError } = useSendPaymentBalance()
  const { state: shieldedState } = useShieldedSync()
  const { submitPayment } = usePaymentTransaction()

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

  // Trigger shielded sync on page load (non-blocking, happens in background)
  useEffect(() => {
    if (walletState.namada.isConnected && shieldedAddress) {
      void triggerShieldedBalanceRefresh({ chainId: NAMADA_CHAIN_ID }).catch((error) => {
        // Don't show error to user - sync will happen again before transaction
        console.debug('[SendPayment] Background sync failed:', error)
      })
    }
  }, [walletState.namada.isConnected, shieldedAddress])

  // Clear error state when component unmounts (navigating away)
  // This prevents error state from persisting when navigating between pages
  useEffect(() => {
    return () => {
      setTxUiState((prev) => {
        if (prev.errorState) {
          return { ...prev, errorState: null }
        }
        return prev
      })
    }
  }, [setTxUiState])

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

  // Determine step completion for flow steps
  const amountComplete = amount.trim() !== '' && !validation.amountError
  const recipientComplete = toAddress.trim() !== '' && !validation.addressError
  const destinationChainComplete = selectedChain !== undefined

  // Determine active step
  let activeStep = 1
  if (amountComplete && !recipientComplete) {
    activeStep = 2
  } else if (amountComplete && recipientComplete && !destinationChainComplete) {
    activeStep = 3
  } else if (amountComplete && recipientComplete && destinationChainComplete) {
    activeStep = 4
  }

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

    // Validate name if save to address book is checked
    if (nameValidationError) {
      notify(buildValidationErrorToast('Address Book', nameValidationError))
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
    }
  }

  // Handle confirmation and submit transaction
  async function handleConfirmPayment(): Promise<void> {
    setShowConfirmationModal(false)

    await submitPayment({
      amount,
      toAddress,
      selectedChain: selectedChain!,
      chainName,
      estimatedFee,
      total,
      transparentAddress: transparentAddress!,
      shieldedAddress,
      isShieldedSyncing: shieldedState.isSyncing,
      onAddressBookSave: () => {
        void saveAddressToBook({
          name: recipientName,
          address: toAddress,
          type: 'evm',
          onSuccess: (name) => {
            notify({
              title: 'Address saved',
              description: `"${name}" has been added to your address book.`,
              level: 'success',
            })
          },
          onError: (error) => {
            notify({
              title: 'Failed to save address',
              description: error,
              level: 'error',
            })
          },
        })
      },
    })
  }

  const handleRetry = () => {
    resetTxUiState(setTxUiState)
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
      <div className="min-h-full container">
        <div className="flex flex-col gap-6 p-12 mx-auto w-full">
        {/* <BreadcrumbNav /> */}

        {/* Transaction Display or Error Display (replaces form when transaction is active, success state, error state, or exiting) */}
        {isAnyTxActive || showSuccessState || errorState || isExiting ? (
          errorState && !isAnyTxActive && !showSuccessState ? (
            <TransactionErrorDisplay error={errorState} onRetry={handleRetry} />
          ) : (
            <TransactionDisplay
              phase={currentPhase}
              showSuccessState={showSuccessState}
              txHash={txHash}
              explorerUrl={explorerUrl}
              onNavigate={() => {
                // Freeze UI to prevent form flash during navigation
                setIsExiting(true)
                navigate('/dashboard')
              }}
              onStartNewTransaction={() => {
                // Reset form state
                setAmount('')
                setToAddress('')
                setRecipientName(null)
                setNameValidationError(null)
                setShowConfirmationModal(false)
                setIsExiting(false)
                // Reset transaction UI state
                resetTxUiState(setTxUiState)
              }}
            />
          )
        ) : (
          <>
            <header className="space-y-2">
              <p className="text-muted-foreground">
                Send USDC from your shielded balance to an EVM address
              </p>
            </header>
            <div className="flex flex-col gap-6">
            {/* Two-column layout: Flow Steps Sidebar + Main Content */}
            <div className="flex flex-col lg:flex-row gap-8">
              {/* Left Sidebar - Flow Steps */}
              <div className="w-full lg:w-64 shrink-0">
                <SendFlowSteps
                  amountComplete={amountComplete}
                  recipientComplete={recipientComplete}
                  destinationChainComplete={destinationChainComplete}
                  activeStep={activeStep}
                />
              </div>

              {/* Right Column - Main Content */}
              <div className="flex-1">
                <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
            
                {/* Step 1: Amount Section */}
                <SendPaymentAmountInput
                  amount={amount}
                  onAmountChange={setAmount}
                  availableBalance={shieldedBalance}
                  isShieldedBalanceLoading={isShieldedBalanceLoading}
                  hasBalanceError={hasBalanceError}
                  validationError={validation.amountError}
                  feeInfo={feeInfo}
                />

                {/* Step 2 & 3: Recipient Address and Destination Chain Sections */}
                <div className="flex flex-col lg:flex-row gap-6">
                  {/* Step 2: Recipient Address Section */}
                  <SendPaymentRecipientSection
                    address={toAddress}
                    onAddressChange={setToAddress}
                    recipientName={recipientName}
                    onRecipientNameChange={setRecipientName}
                    onNameValidationChange={(_isValid, error) => setNameValidationError(error)}
                    validationError={validation.addressError}
                    autoFillAddress={walletState.metaMask.account}
                    onAutoFill={handleAutoFill}
                    disabled={isAnyTxActive}
                  />

                  {/* Step 3: Destination Chain Section */}
                  <div className="flex-1 card card-xl">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-1 rounded">
                        Step 3
                      </span>
                      <label className="text-sm font-semibold">Destination chain</label>
                    </div>
                    <p className="text-sm text-muted-foreground mb-3">
                      The chain you wish to send USDC to
                    </p>
                    <ChainSelect
                      value={selectedChain}
                      onChange={setSelectedChain}
                      disabled={false}
                      showEstimatedTime={true}
                      timeType="send"
                    />
                  </div>
                </div>

                {/* Step 4: Fees & Review Section */}
                <SendPaymentFeeDisplay
                  feeInfo={feeInfo}
                  isEstimatingFee={isEstimatingFee}
                  total={total}
                  amount={amount}
                />

                {/* Send Summary Card */}
                <SendSummaryCard
                  amount={amount}
                  chainName={chainName}
                  isValid={validation.isValid && !nameValidationError}
                  validationError={
                    (!validation.isValid || nameValidationError) && !isAnyTxActive
                      ? nameValidationError || validation.amountError || validation.addressError || 'Please fill in all required fields'
                      : null
                  }
                  onContinue={() => {
                    if (validation.isValid && !nameValidationError) {
                      setShowConfirmationModal(true)
                    } else {
                      if (nameValidationError) {
                        notify(buildValidationErrorToast('Address Book', nameValidationError))
                      }
                      if (validation.amountError) {
                        notify(buildValidationErrorToast('Amount', validation.amountError))
                      }
                      if (validation.addressError) {
                        notify(buildValidationErrorToast('Address', validation.addressError))
                      }
                    }
                  }}
                  isSubmitting={false}
                  currentPhase={null}
                />
                </form>
                <div className='min-h-12' />
              </div>
            </div>
          </div>
            </>
        )}

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
      </div>
    </RequireNamadaConnection>
  )
}
