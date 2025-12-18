import { useState, useEffect, useRef, type FormEvent } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useSetAtom, useAtomValue, useAtom } from 'jotai'
import { jotaiStore } from '@/store/jotaiStore'
import { Loader2 } from 'lucide-react'
import { ChainSelect } from '@/components/common/ChainSelect'
import { DepositConfirmationModal } from '@/components/deposit/DepositConfirmationModal'
import { saveAddressToBook } from '@/utils/addressBookUtils'
import { DepositFlowSteps } from '@/components/deposit/DepositFlowSteps'
import { DepositSummaryCard } from '@/components/deposit/DepositSummaryCard'
import { TransactionDisplay } from '@/components/tx/TransactionDisplay'
import { useWallet } from '@/hooks/useWallet'
import { useToast } from '@/hooks/useToast'
import { RequireMetaMaskConnection } from '@/components/wallet/RequireMetaMaskConnection'
import { validateDepositForm } from '@/services/validation'
import { buildValidationErrorToast } from '@/utils/toastHelpers'
import { useDepositFeeEstimate } from '@/hooks/useDepositFeeEstimate'
import { type DepositTransactionDetails } from '@/services/deposit/depositService'
import { depositRecipientAddressAtom, depositFallbackSelectionAtom, type DepositFallbackSelection } from '@/atoms/appAtom'
import { txUiAtom, isAnyTransactionActiveAtom, resetTxUiState } from '@/atoms/txUiAtom'
import { loadNobleFallbackAddress } from '@/services/storage/nobleFallbackStorage'
import { loadDerivedFallbackAddress } from '@/services/storage/nobleFallbackDerivedStorage'
import { useChainSelection } from '@/hooks/useChainSelection'
import { useDepositBalance } from '@/hooks/useDepositBalance'
import { useNobleFallbackDerivation } from '@/hooks/useNobleFallbackDerivation'
import { useNobleRegistrationStatus } from '@/hooks/useNobleRegistrationStatus'
import { useDepositTransaction } from '@/hooks/useDepositTransaction'
import { TransactionErrorDisplay } from '@/components/common/TransactionErrorDisplay'
import { DepositAmountInput } from '@/components/deposit/DepositAmountInput'
import { DepositRecipientSection } from '@/components/deposit/DepositRecipientSection'
import { DepositFeeDisplay } from '@/components/deposit/DepositFeeDisplay'

export function Deposit() {
  const navigate = useNavigate()
  const location = useLocation()
  const { notify } = useToast()
  const { state: walletState } = useWallet()
  const setDepositRecipientAddress = useSetAtom(depositRecipientAddressAtom)
  const depositFallbackSelection = useAtomValue(depositFallbackSelectionAtom)
  const setDepositFallbackSelection = useSetAtom(depositFallbackSelectionAtom)

  // Form state
  const [amount, setAmount] = useState('')
  const [toAddress, setToAddress] = useState('')
  const [recipientName, setRecipientName] = useState<string | null>(null)
  const [nameValidationError, setNameValidationError] = useState<string | null>(null)
  const [showConfirmationModal, setShowConfirmationModal] = useState(false)
  const [depositRecipientType, setDepositRecipientType] = useState<'transparent' | 'custom'>('transparent')
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false)

  // Global transaction UI state
  const [txUiState, setTxUiState] = useAtom(txUiAtom)
  const isAnyTxActive = useAtomValue(isAnyTransactionActiveAtom)

  // Local state derived from global state for convenience
  const currentPhase = txUiState.phase
  const txHash = txUiState.txHash
  const explorerUrl = txUiState.explorerUrl
  const errorState = txUiState.errorState
  const showSuccessState = txUiState.showSuccessState

  // State for custom address override checkbox
  const [useCustomOverride, setUseCustomOverride] = useState(false)

  // Custom hooks
  const { selectedChain, chainName, setSelectedChain } = useChainSelection({
    strategy: 'preferred',
    updatePreferred: true,
    useMetaMaskFallback: true,
  })
  const { availableBalance, hasEvmError } = useDepositBalance(selectedChain)
  const { derivationState, deriveFallback } = useNobleFallbackDerivation()
  const registrationStatus = useNobleRegistrationStatus(toAddress)
  const { submitDeposit } = useDepositTransaction()

  // Auto-load fallback addresses on mount and when account changes
  useEffect(() => {
    const currentEvmAddress = walletState.metaMask.account

    // Load custom address from settings
    const customAddress = loadNobleFallbackAddress()

    // Load derived address for current account (if connected)
    const derivedAddress = currentEvmAddress ? loadDerivedFallbackAddress(currentEvmAddress) : undefined

    // Default behavior: use derived address (unless custom override is checked)
    // If custom override is checked, use custom address
    // If no derived address available and no custom override, set to 'none' (will prompt derivation)
    let newSelection: DepositFallbackSelection
    if (useCustomOverride && customAddress) {
      newSelection = { source: 'custom', address: customAddress }
    } else if (derivedAddress) {
      newSelection = { source: 'derived', address: derivedAddress }
    } else {
      newSelection = { source: 'none', address: undefined }
    }

    // Only update if selection actually changed to avoid unnecessary re-renders
    const currentSelection = jotaiStore.get(depositFallbackSelectionAtom)

    if (
      newSelection.source !== currentSelection.source ||
      newSelection.address !== currentSelection.address
    ) {
      setDepositFallbackSelection(newSelection)
    }
  }, [
    walletState.metaMask.account,
    useCustomOverride,
    setDepositFallbackSelection,
  ])

  // Sync toAddress to global atom so it can be accessed from anywhere
  useEffect(() => {
    setDepositRecipientAddress(toAddress || undefined)
  }, [toAddress, setDepositRecipientAddress])

  // Auto-populate transparent address when "My transparent balance" is selected
  useEffect(() => {
    if (depositRecipientType === 'transparent' && walletState.namada.account) {
      setToAddress(walletState.namada.account)
    } else if (depositRecipientType === 'transparent' && !walletState.namada.account) {
      // If transparent is selected but no address available, clear toAddress
      setToAddress('')
    }
  }, [depositRecipientType, walletState.namada.account])

  // Handle switching to custom: clear address if it was the transparent address
  // Only clear on initial switch, not when user manually fills it later
  const prevRecipientTypeRef = useRef<'transparent' | 'custom'>(depositRecipientType)
  useEffect(() => {
    // Only clear if we just switched from transparent to custom (one-time on switch)
    const justSwitchedToCustom =
      depositRecipientType === 'custom' &&
      prevRecipientTypeRef.current === 'transparent'

    if (justSwitchedToCustom && toAddress === walletState.namada.account) {
      setToAddress('')
    }

    // Update ref when recipient type changes
    prevRecipientTypeRef.current = depositRecipientType
  }, [depositRecipientType]) // Only run when recipient type changes

  // Clear validation errors when switching recipient types
  useEffect(() => {
    // Clear name validation error when switching types
    if (depositRecipientType === 'transparent') {
      setRecipientName(null)
      setNameValidationError(null)
    }
  }, [depositRecipientType])

  // Reset transaction UI state when navigating away from this page
  useEffect(() => {
    // Reset state if we're not on the deposit page
    const isOnPage = location.pathname === '/deposit'
    if (!isOnPage) {
      resetTxUiState(setTxUiState)
    }
    
    // Cleanup: reset state when component unmounts (navigating away)
    return () => {
      resetTxUiState(setTxUiState)
    }
  }, [location.pathname, setTxUiState])


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
  
  // Validate that deposit amount exceeds Noble registration fee when applicable
  // Only validate when Noble registration fee applies (nobleRegUsd > 0)
  const nobleRegFeeApplies = feeInfo?.nobleRegUsd !== undefined && feeInfo.nobleRegUsd > 0
  const validation = validateDepositForm(
    amount,
    availableBalance,
    feeValueForValidation,
    toAddress,
    {
      feeAmount: nobleRegFeeApplies ? feeInfo.nobleRegUsd : undefined,
      feeToken: nobleRegFeeApplies ? 'USDC' : undefined,
      amountToken: 'USDC',
    }
  )

  // Determine step completion for flow steps
  const amountComplete = amount.trim() !== '' && !validation.amountError
  const recipientComplete = toAddress.trim() !== '' && !validation.addressError
  const sourceChainComplete = selectedChain !== undefined

  // Determine active step
  let activeStep = 1
  if (amountComplete && !recipientComplete) {
    activeStep = 2
  } else if (amountComplete && recipientComplete && !sourceChainComplete) {
    activeStep = 3
  } else if (amountComplete && recipientComplete && sourceChainComplete) {
    activeStep = 4
  }

  // Calculate total - USDC amount + fee USD (if available) + Noble registration fee
  const amountNum = parseFloat(amount || '0')
  const feeUsd = feeInfo?.totalUsd ?? 0
  const nobleRegUsd = feeInfo?.nobleRegUsd ?? 0
  const totalUsd = amountNum + feeUsd + nobleRegUsd
  const total = totalUsd.toFixed(4)

  // Shared function to handle deposit continuation (derivation, validation, show modal)
  async function handleDepositContinue(): Promise<void> {
    // Check if derivation is needed
    const needsDerivation =
      walletState.metaMask.isConnected &&
      walletState.metaMask.account &&
      !useCustomOverride &&
      depositFallbackSelection.source === 'none'

    if (needsDerivation) {
      // Trigger derivation before proceeding
      const derivationSuccess = await deriveFallback()
      // If derivation failed, halt the flow
      if (!derivationSuccess) {
        return
      }
      // Derivation succeeded, continue with the flow
    }

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

  // Handle form submission
  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    await handleDepositContinue()
  }

  // Handle confirmation and submit transaction
  async function handleConfirmDeposit(): Promise<void> {
    setShowConfirmationModal(false)

    await submitDeposit({
      amount,
      toAddress,
      selectedChain: selectedChain!,
      chainName,
      estimatedFee,
      total,
      evmAddress,
      onAddressBookSave: () => {
        void saveAddressToBook({
          name: recipientName,
          address: toAddress,
          type: 'namada',
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
      <div className="min-h-full container">
        <div className="flex flex-col gap-6 p-12 mx-auto w-full">
          {/* <BreadcrumbNav /> */}

          <header className="space-y-2">
            <p className="text-muted-foreground">
              Deposit USDC from an EVM chain to your Namada address
            </p>
          </header>

          {/* Transaction Display or Error Display (replaces form when transaction is active, success state, or error state) */}
          {isAnyTxActive || showSuccessState || errorState ? (
            errorState && !isAnyTxActive && !showSuccessState ? (
              <TransactionErrorDisplay error={errorState} onRetry={handleRetry} />
            ) : (
              <TransactionDisplay
                phase={currentPhase}
                showSuccessState={showSuccessState}
                txHash={txHash}
                explorerUrl={explorerUrl}
                onNavigate={() => {
                  // Navigate first, then reset state after route transition completes
                  navigate('/dashboard')
                  // Delay state reset to allow route transition
                  setTimeout(() => {
                    resetTxUiState(setTxUiState)
                  }, 350)
                }}
                countdownSeconds={3}
              />
            )
          ) : (
            <div className="flex flex-col gap-6">
              {/* Two-column layout: Flow Steps Sidebar + Main Content */}
              <div className="flex flex-col lg:flex-row gap-8">
                {/* Left Sidebar - Flow Steps */}
                <div className="w-full lg:w-64 shrink-0">
                  <DepositFlowSteps
                    amountComplete={amountComplete}
                    recipientComplete={recipientComplete}
                    sourceChainComplete={sourceChainComplete}
                    activeStep={activeStep}
                  />
                </div>

                {/* Right Column - Main Content */}
                <div className="flex-1">
                  <form className="flex flex-col gap-6" onSubmit={handleSubmit}>

                    {/* Step 1: Amount Section */}
                    <DepositAmountInput
                      amount={amount}
                      onAmountChange={setAmount}
                      availableBalance={availableBalance}
                      hasEvmError={hasEvmError}
                      validationError={validation.amountError}
                      feeInfo={feeInfo}
                    />

                    {/* Step 2 & 3: Recipient Address and Source Chain Sections */}
                    <div className="flex flex-col lg:flex-row gap-6">
                      {/* Step 2: Recipient Address Section */}
                      <DepositRecipientSection
                        recipientType={depositRecipientType}
                        onRecipientTypeChange={setDepositRecipientType}
                        address={toAddress}
                        onAddressChange={setToAddress}
                        recipientName={recipientName}
                        onRecipientNameChange={setRecipientName}
                        onNameValidationChange={(_isValid, error) => setNameValidationError(error)}
                        validationError={validation.addressError}
                        showAdvanced={showAdvancedOptions}
                        onShowAdvancedChange={setShowAdvancedOptions}
                        fallbackSelection={depositFallbackSelection}
                        useCustomOverride={useCustomOverride}
                        onCustomOverrideChange={setUseCustomOverride}
                        derivationState={derivationState}
                        onDerive={deriveFallback}
                        registrationStatus={registrationStatus}
                        isAnyTxActive={isAnyTxActive}
                        namadaConnected={walletState.namada.isConnected}
                        namadaAccount={walletState.namada.account}
                        metaMaskConnected={walletState.metaMask.isConnected}
                        metaMaskAccount={walletState.metaMask.account}
                        onAutoFill={() => {
                          const namadaAddress = walletState.namada.account
                          if (namadaAddress) {
                            setToAddress(namadaAddress)
                          }
                        }}
                      />

                      {/* Step 3: Source Chain Section */}
                      <div className="flex-1 card card-xl">
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-1 rounded">
                            Step 3
                          </span>
                          <label className="text-sm font-semibold">Source chain</label>
                        </div>
                        <p className="text-sm text-muted-foreground mb-3">
                          The chain you wish to deposit USDC from
                        </p>
                        <ChainSelect
                          value={selectedChain}
                          onChange={setSelectedChain}
                          disabled={isAnyTxActive}
                          showEstimatedTime={true}
                          timeType="deposit"
                        />
                      </div>
                    </div>

                    {/* Step 4: Fees & Review Section */}
                    <DepositFeeDisplay
                      feeInfo={feeInfo}
                      isEstimatingFee={isEstimatingFee}
                      total={total}
                    />

                    {/* Deposit Summary Card */}
                    <DepositSummaryCard
                      amount={amount}
                      chainName={chainName}
                      isValid={validation.isValid && !nameValidationError}
                      validationError={
                        (!validation.isValid || nameValidationError)
                          ? nameValidationError || validation.amountError || validation.addressError || 'Please fill in all required fields'
                          : null
                      }
                      onContinue={handleDepositContinue}
                      isSubmitting={false}
                      currentPhase={null}
                    />
                  </form>
                  <div className='min-h-12' />
                </div>
              </div>
            </div>
          )}

          {/* Confirmation Modal */}
          <DepositConfirmationModal
            open={showConfirmationModal}
            onClose={() => setShowConfirmationModal(false)}
            onConfirm={handleConfirmDeposit}
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
    </RequireMetaMaskConnection>
  )
}
