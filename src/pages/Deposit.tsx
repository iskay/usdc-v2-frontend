import { useState, useEffect, useRef, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useSetAtom, useAtomValue, useAtom } from 'jotai'
import { jotaiStore } from '@/store/jotaiStore'
import { Loader2, AlertCircle, CheckCircle2, Info } from 'lucide-react'
import { CopyButton } from '@/components/common/CopyButton'
import { Button } from '@/components/common/Button'
import { Tooltip } from '@/components/common/Tooltip'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { balanceSyncAtom, balanceErrorsAtom } from '@/atoms/balanceAtom'
// import { BreadcrumbNav } from '@/components/common/BreadcrumbNav'
import { ChainSelect } from '@/components/common/ChainSelect'
import { DepositConfirmationModal } from '@/components/deposit/DepositConfirmationModal'
import { RecipientAddressInput } from '@/components/recipient/RecipientAddressInput'
import { addAddress } from '@/services/addressBook/addressBookService'
import { DepositFlowSteps } from '@/components/deposit/DepositFlowSteps'
import { DepositSummaryCard } from '@/components/deposit/DepositSummaryCard'
import { TransactionDisplay } from '@/components/tx/TransactionDisplay'
import { useWallet } from '@/hooks/useWallet'
import { useBalance } from '@/hooks/useBalance'
import { useToast } from '@/hooks/useToast'
import { RequireMetaMaskConnection } from '@/components/wallet/RequireMetaMaskConnection'
import { validateDepositForm, handleAmountInputChange, validateNamadaAddress } from '@/services/validation'
import {
  buildTransactionSuccessToast,
  buildTransactionErrorToast,
  buildTransactionStatusToast,
  buildValidationErrorToast,
  buildCopySuccessToast,
} from '@/utils/toastHelpers'
import { checkCurrentDepositRecipientRegistration } from '@/services/deposit/nobleForwardingService'
import { useDepositFeeEstimate } from '@/hooks/useDepositFeeEstimate'
import {
  buildDepositTransaction,
  signDepositTransaction,
  broadcastDepositTransaction,
  saveDepositTransaction,
  type DepositTransactionDetails,
} from '@/services/deposit/depositService'
import { useTxTracker } from '@/hooks/useTxTracker'
import { transactionStorageService, type StoredTransaction } from '@/services/tx/transactionStorageService'
import { fetchEvmChainsConfig } from '@/services/config/chainConfigService'
import { preferredChainKeyAtom, depositRecipientAddressAtom, depositFallbackSelectionAtom, type DepositFallbackSelection } from '@/atoms/appAtom'
import { findChainByChainId, getDefaultChainKey } from '@/config/chains'
import { getEvmTxExplorerUrl } from '@/utils/explorerUtils'
import { sanitizeError } from '@/utils/errorSanitizer'
import { txUiAtom, isAnyTransactionActiveAtom, resetTxUiState } from '@/atoms/txUiAtom'
import { loadNobleFallbackAddress } from '@/services/storage/nobleFallbackStorage'
import { loadDerivedFallbackAddress } from '@/services/storage/nobleFallbackDerivedStorage'
import { deriveNobleFallbackFromMetaMask, saveDerivedFallbackToStorage } from '@/services/fallback/nobleFallbackDerivationService'

export function Deposit() {
  const navigate = useNavigate()
  const { upsertTransaction } = useTxTracker({ enablePolling: false })
  const { notify, updateToast, dismissToast } = useToast()
  const { state: walletState } = useWallet()
  const { state: balanceState, refresh } = useBalance()
  const balanceSyncState = useAtomValue(balanceSyncAtom)
  const balanceErrors = useAtomValue(balanceErrorsAtom)
  const preferredChainKey = useAtomValue(preferredChainKeyAtom)
  const setPreferredChainKey = useSetAtom(preferredChainKeyAtom)
  const setDepositRecipientAddress = useSetAtom(depositRecipientAddressAtom)
  const depositFallbackSelection = useAtomValue(depositFallbackSelectionAtom)
  const setDepositFallbackSelection = useSetAtom(depositFallbackSelectionAtom)

  // Form state
  const [amount, setAmount] = useState('')
  const [toAddress, setToAddress] = useState('')
  const [recipientName, setRecipientName] = useState<string | null>(null)
  const [nameValidationError, setNameValidationError] = useState<string | null>(null)
  const [selectedChain, setSelectedChain] = useState<string | undefined>(undefined)
  const [showConfirmationModal, setShowConfirmationModal] = useState(false)
  const [depositRecipientType, setDepositRecipientType] = useState<'transparent' | 'custom'>('transparent')
  
  // Global transaction UI state
  const [txUiState, setTxUiState] = useAtom(txUiAtom)
  const isAnyTxActive = useAtomValue(isAnyTransactionActiveAtom)
  
  // Local state derived from global state for convenience
  const currentPhase = txUiState.phase
  const txHash = txUiState.txHash
  const explorerUrl = txUiState.explorerUrl
  const errorState = txUiState.errorState
  const showSuccessState = txUiState.showSuccessState

  // Noble forwarding registration status
  const [registrationStatus, setRegistrationStatus] = useState<{
    isLoading: boolean
    isRegistered: boolean | null
    forwardingAddress: string | null
    error: string | null
  }>({
    isLoading: false,
    isRegistered: null,
    forwardingAddress: null,
    error: null,
  })

  // Noble fallback derivation state
  const [derivationState, setDerivationState] = useState<{
    isLoading: boolean
    stage: 'idle' | 'signing' | 'extracting' | 'deriving' | 'success' | 'error'
    error: string | null
  }>({
    isLoading: false,
    stage: 'idle',
    error: null,
  })

  // Auto-load fallback addresses on mount and when account changes
  useEffect(() => {
    const currentEvmAddress = walletState.metaMask.account
    
    // Load custom address from settings
    const customAddress = loadNobleFallbackAddress()
    
    // Load derived address for current account (if connected)
    const derivedAddress = currentEvmAddress ? loadDerivedFallbackAddress(currentEvmAddress) : undefined
    
    // Auto-select priority: derived > custom > none
    let newSelection: DepositFallbackSelection
    if (derivedAddress) {
      newSelection = { source: 'derived', address: derivedAddress }
    } else if (customAddress) {
      newSelection = { source: 'custom', address: customAddress }
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

  // Track the current address being checked to prevent race conditions
  const checkingAddressRef = useRef<string | null>(null)

  // Debounced check for Noble forwarding registration
  useEffect(() => {
    // Only check if address is valid
    const addressValidation = validateNamadaAddress(toAddress)
    if (!addressValidation.isValid || !addressValidation.value) {
      // Reset status if address is invalid
      checkingAddressRef.current = null
      setRegistrationStatus({
        isLoading: false,
        isRegistered: null,
        forwardingAddress: null,
        error: null,
      })
      return
    }

    const addressToCheck = addressValidation.value
    checkingAddressRef.current = addressToCheck

    // Debounce the check
    const timeoutId = setTimeout(async () => {
      // Double-check that we're still checking the same address
      if (checkingAddressRef.current !== addressToCheck) {
        return
      }

      setRegistrationStatus({
        isLoading: true,
        isRegistered: null,
        forwardingAddress: null,
        error: null,
      })

      try {
        const fallback = depositFallbackSelection.address || ''
        const status = await checkCurrentDepositRecipientRegistration(addressToCheck, undefined, fallback)
        
        // Only update if we're still checking the same address
        if (checkingAddressRef.current === addressToCheck) {
          setRegistrationStatus({
            isLoading: false,
            isRegistered: status.error ? null : status.exists,
            forwardingAddress: status.address || null,
            error: status.error || null,
          })
        }
      } catch (error) {
        // Only update if we're still checking the same address
        if (checkingAddressRef.current !== addressToCheck) {
          return
        }

        // Don't show error if it's just that no address is available
        const errorMessage = error instanceof Error ? error.message : String(error)
        if (errorMessage.includes('No deposit recipient address')) {
          setRegistrationStatus({
            isLoading: false,
            isRegistered: null,
            forwardingAddress: null,
            error: null,
          })
        } else {
          setRegistrationStatus({
            isLoading: false,
            isRegistered: null,
            forwardingAddress: null,
            error: errorMessage,
          })
        }
      }
    }, 500) // 500ms debounce

    return () => {
      clearTimeout(timeoutId)
      // Clear the ref if the effect is cleaning up due to address change
      if (checkingAddressRef.current === addressToCheck) {
        checkingAddressRef.current = null
      }
    }
  }, [toAddress, depositFallbackSelection.address])

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

  // Get live EVM balance from balance state
  // Check for EVM balance error state
  const hasEvmError = balanceSyncState.evmStatus === 'error' && balanceErrors.evm
  const evmBalance = balanceState.evm.usdc
  const availableBalance = hasEvmError ? '--' : (evmBalance !== '--' ? evmBalance : '--')

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
      // Only fetch EVM balance (not Namada balances)
      void refreshRef.current({ balanceTypes: ['evm'] })
    }
  }, [
    walletState.metaMask.isConnected,
    walletState.metaMask.account,
    walletState.metaMask.chainId,
  ])

  // Load chain: prefer preferredChainKeyAtom, then MetaMask chainId, then default from config
  useEffect(() => {
    let mounted = true

    async function loadChain() {
      try {
        // Precedence order: atom -> metamask value -> default
        let chainKey: string | undefined

        // 1. First check if preferredChainKeyAtom has a value
        if (preferredChainKey) {
          chainKey = preferredChainKey
        } else {
          // 2. Try to derive from MetaMask chainId
        const config = await fetchEvmChainsConfig()
          if (walletState.metaMask.isConnected && walletState.metaMask.chainId && config) {
            const chain = findChainByChainId(config, walletState.metaMask.chainId)
            if (chain) {
              chainKey = chain.key
              // Set preferredChainKeyAtom when deriving from MetaMask
              if (mounted) {
                setPreferredChainKey(chainKey)
              }
            }
          }

          // 3. Fall back to default chain from config
          if (!chainKey && config) {
            chainKey = getDefaultChainKey(config)
          }
        }

        // Set selectedChain if we have a chainKey
        if (mounted && chainKey) {
          setSelectedChain(chainKey)
        }
      } catch (error) {
        console.error('[Deposit] Failed to load chain:', error)
      }
    }

    void loadChain()

    return () => {
      mounted = false
    }
  }, [preferredChainKey, walletState.metaMask.isConnected, walletState.metaMask.chainId, setPreferredChainKey])


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
        console.error('[Deposit] Failed to load chain name:', error)
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
      // Only fetch EVM balance (not Namada balances)
      void refreshRef.current({ chainKey: selectedChain, balanceTypes: ['evm'] })
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

  // Handle confirmation and submit transaction
  async function handleConfirmDeposit(): Promise<void> {
    setShowConfirmationModal(false)
    
    // Save address to address book immediately on initiation (non-blocking)
    // This happens before transaction processing and does not depend on tx outcome
    void saveAddressToBook()

    setTxUiState({
      ...txUiState,
      isSubmitting: true,
      phase: 'building',
      errorState: null,
      txHash: null,
      explorerUrl: undefined,
      showSuccessState: false,
      transactionType: 'deposit',
    })

    // Track transaction state for error handling
    let tx: Awaited<ReturnType<typeof buildDepositTransaction>> | undefined
    let signedTx: Awaited<ReturnType<typeof signDepositTransaction>> | undefined
    let currentTx: StoredTransaction | undefined

    // Use a consistent toast ID for transaction status updates (moved outside try so it's accessible in catch)
    const txToastId = `deposit-tx-${Date.now()}`

    try {
      // Build transaction details
      const transactionDetails: DepositTransactionDetails = {
        amount,
        fee: estimatedFee,
        total,
        destinationAddress: toAddress,
        chainName,
        ...(evmAddress && { senderAddress: evmAddress }), // Store EVM sender address if available
      }

      // Build transaction
      notify(buildTransactionStatusToast('building', 'deposit', txToastId))
      tx = await buildDepositTransaction({
        amount,
        destinationAddress: toAddress,
        sourceChain: selectedChain!, // Safe: guarded by check at line 177
      })

      // Save transaction immediately after build (for error tracking)
      currentTx = {
        ...tx,
        depositDetails: transactionDetails,
        updatedAt: Date.now(),
      }
      transactionStorageService.saveTransaction(currentTx)
      upsertTransaction(tx)

      // Sign transaction (no-op, actual signing happens during broadcast)
      setTxUiState({ ...txUiState, phase: 'signing' })
      updateToast(txToastId, buildTransactionStatusToast('signing', 'deposit'))
      signedTx = await signDepositTransaction(tx)
      
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
      
      const txHashResult = await broadcastDepositTransaction(signedTx, {
        onSigningComplete: () => {
          // Phase 3: Submitting (only after signing is complete)
          setTxUiState({ ...txUiState, phase: 'submitting' })
          updateToast(txToastId, buildTransactionStatusToast('submitting', 'deposit'))
        },
      })
      
      const txHash = txHashResult

      // Update transaction with hash
      const txWithHash = {
            ...signedTx,
            hash: txHash,
        status: 'broadcasted' as const,
      }

      // Save transaction to unified storage with deposit details
      // Frontend polling handles all tracking (no backend registration needed)
      const savedTx = await saveDepositTransaction(txWithHash, transactionDetails)

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
      setTxUiState({ ...txUiState, phase: null, txHash, showSuccessState: true })
      if (selectedChain) {
        getEvmTxExplorerUrl(selectedChain, txHash).then((url) => {
          setTxUiState((prev) => ({ ...prev, explorerUrl: url }))
        }).catch(() => {
          // Silently fail if explorer URL can't be fetched
        })
      }
    } catch (error) {
      // Dismiss the loading toast if it exists
      dismissToast(txToastId)
      
      console.error('[Deposit] Deposit submission failed:', error)
      const sanitized = sanitizeError(error)
      const message = sanitized.message
      
      // Save error transaction to storage for history tracking
      try {
        // Build transaction details for error case
        const transactionDetails: DepositTransactionDetails = {
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
              direction: 'deposit',
              status: 'error',
              errorMessage: message,
              depositDetails: transactionDetails,
            }
        
        transactionStorageService.saveTransaction(errorTx)
        upsertTransaction(errorTx)
      } catch (saveError) {
        console.error('[Deposit] Failed to save error transaction:', saveError)
      }
      
      // Show error toast with action to view transaction if available
      const errorTxForToast = currentTx || (tx ? { id: tx.id, direction: 'deposit' as const } : undefined)
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
          title: 'Deposit Failed',
          description: message,
          level: 'error',
        })
      }
      
      // Set error state for enhanced error display
      setTxUiState({ ...txUiState, errorState: { message }, phase: null, isSubmitting: false })
    } finally {
      // Reset isSubmitting in global state if not already reset
      if (txUiState.isSubmitting) {
        setTxUiState((prev) => ({ ...prev, isSubmitting: false }))
      }
    }
  }

  const handleRetry = () => {
    resetTxUiState(setTxUiState)
  }

  // Handle Auto Fill for Namada address
  // Handle Noble fallback address derivation from MetaMask
  async function handleDeriveFallbackFromMetaMask(): Promise<void> {
    if (!walletState.metaMask.isConnected || !walletState.metaMask.account) {
      notify({
        title: 'MetaMask Not Connected',
        description: 'Please connect your MetaMask wallet to derive a fallback address.',
        level: 'error',
      })
      return
    }

    setDerivationState({
      isLoading: true,
      stage: 'signing',
      error: null,
    })

    try {
      // Stage 1: Request signature
      notify({
        title: 'Requesting Signature',
        description: 'Please sign the message in MetaMask to derive your Noble fallback address.',
        level: 'info',
      })

      setDerivationState({
        isLoading: true,
        stage: 'extracting',
        error: null,
      })

      // Stage 2: Extract public key
      notify({
        title: 'Extracting Public Key',
        description: 'Recovering your public key from the signature...',
        level: 'info',
      })

      setDerivationState({
        isLoading: true,
        stage: 'deriving',
        error: null,
      })

      // Stage 3: Derive Noble address
      notify({
        title: 'Deriving Noble Address',
        description: 'Converting your public key to a Noble address...',
        level: 'info',
      })

      const result = await deriveNobleFallbackFromMetaMask({
        evmAddress: walletState.metaMask.account,
      })

      // Save to derived storage (keyed by EVM address)
      await saveDerivedFallbackToStorage(result)

      // Update selection atom to use derived address
      setDepositFallbackSelection({
        source: 'derived',
        address: result.nobleAddress,
      })

      setDerivationState({
        isLoading: false,
        stage: 'success',
        error: null,
      })

      notify({
        title: 'Address Derived Successfully',
        description: `Noble fallback address: ${result.nobleAddress.slice(0, 16)}...`,
        level: 'success',
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to derive Noble fallback address'
      
      setDerivationState({
        isLoading: false,
        stage: 'error',
        error: errorMessage,
      })

      notify({
        title: 'Derivation Failed',
        description: errorMessage,
        level: 'error',
      })
    }
  }

  function handleAutoFill() {
    // Get Namada address from wallet state
    const namadaAddress = walletState.namada.account
    if (namadaAddress) {
      setToAddress(namadaAddress)
    }
  }

  // Save address to address book if name was provided
  // This is called immediately on transaction initiation and does not block the transaction flow
  async function saveAddressToBook() {
    if (!recipientName || !toAddress) {
      return
    }

    try {
      const result = addAddress({
        name: recipientName,
        address: toAddress,
        type: 'namada',
      })
      if (result.success) {
        notify({
          title: 'Address saved',
          description: `"${recipientName}" has been added to your address book.`,
          level: 'success',
        })
      } else {
        // Show error toast but don't throw - transaction should continue
        notify({
          title: 'Failed to save address',
          description: result.error || 'Could not save address to address book',
          level: 'error',
        })
      }
    } catch (error) {
      // Catch any unexpected errors and show toast, but don't throw
      console.error('[Deposit] Error saving address:', error)
      notify({
        title: 'Failed to save address',
        description: error instanceof Error ? error.message : 'An unexpected error occurred',
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
      <div className="min-h-full container">
        <div className="flex flex-col gap-6 p-12 mx-auto w-full">
        {/* <BreadcrumbNav /> */}

        <header className="space-y-2">
          <p className="text-muted-foreground">
            Deposit USDC from an EVM chain to your Namada address
          </p>
        </header>

        {/* Enhanced Error State */}
        {errorState && (
          <div className="rounded-lg border border-error/50 bg-error/10 p-4 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-error shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-error mb-1">
                  Transaction Failed
                </h3>
                <p className="text-sm text-error/90 mb-3">
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

        {/* Transaction Display (replaces form when transaction is active or success state is shown) */}
        {isAnyTxActive || showSuccessState ? (
          <TransactionDisplay
            phase={currentPhase}
            showSuccessState={showSuccessState}
            txHash={txHash}
            explorerUrl={explorerUrl}
            onNavigate={() => {
              // Navigate first, then reset state after route transition completes
              navigate('/dashboard')
              // Delay state reset to allow fade-out and route transition (500ms fade + 350ms route transition)
              setTimeout(() => {
                resetTxUiState(setTxUiState)
              }, 600)
            }}
            countdownSeconds={3}
          />
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
                <div className="card card-xl">
                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-1 rounded">
                        Step 1
                      </span>
                      <span className="text-sm font-semibold">Amount</span>
                    </div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        Available {availableBalance} USDC
                      </span>
                        {hasEvmError && (
                          <Tooltip content="Could not query EVM balance from chain" side="top">
                            <AlertCircle className="h-3.5 w-3.5 text-error" aria-label="EVM balance error" />
                          </Tooltip>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (availableBalance !== '--') {
                            const balanceNum = parseFloat(availableBalance)
                            const feeUsd = feeInfo?.totalUsd ?? 0
                            const nobleRegUsd = feeInfo?.nobleRegUsd ?? 0
                            const totalFees = feeUsd + nobleRegUsd
                            const maxAmount = Math.max(0, balanceNum - totalFees)
                            // Format to 6 decimal places to match input handling
                            setAmount(maxAmount.toFixed(6).replace(/\.?0+$/, ''))
                          }
                        }}
                        disabled={availableBalance === '--'}
                        className="text-sm font-medium text-primary hover:text-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Use Max
                      </button>
                    </div>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-muted-foreground">$</span>
                    <input
                      type="text"
                      value={amount}
                      onChange={(e) => handleAmountInputChange(e, setAmount, 6)}
                      className="flex-1 border-none bg-transparent p-0 text-3xl font-bold focus:outline-none focus:ring-0 placeholder:text-muted-foreground/30"
                      placeholder="0.00"
                      inputMode="decimal"
                      disabled={false}
                    />
                    <div className="flex items-center gap-1.5">
                      <img
                        src="/assets/logos/usdc-logo.svg"
                        alt="USDC"
                        className="h-4 w-4"
                      />
                      <span className="text-sm text-muted-foreground">USDC</span>
                    </div>
                  </div>
                  {/* Validation error for amount */}
                  {validation.amountError && amount.trim() !== '' && (
                    <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span className="flex-1">{validation.amountError}</span>
                    </div>
                  )}
                </div>

                {/* Step 2 & 3: Recipient Address and Source Chain Sections */}
                <div className="flex flex-col lg:flex-row gap-6">
                  {/* Step 2: Recipient Address Section */}
                  <div className="flex-1 card card-xl">
                  <div className="flex items-baseline justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-1 rounded">
                        Step 2
                      </span>
                      <label className="text-sm font-semibold">Deposit to</label>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">
                    Namada address where your USDC will arrive
                  </p>
                  
                  {/* Radio selector for recipient type */}
                  <RadioGroup
                    value={depositRecipientType}
                    onValueChange={(value) => setDepositRecipientType(value as 'transparent' | 'custom')}
                    className="flex flex-col gap-3 mb-3"
                    disabled={isAnyTxActive}
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem
                        value="transparent"
                        id="transparent"
                        disabled={isAnyTxActive || !walletState.namada.isConnected}
                        className="mt-0.5"
                      />
                      <label
                        htmlFor="transparent"
                        className="flex-1 cursor-pointer"
                      >
                        <div className="flex-1">
                          <span className="text-sm font-medium">
                            My transparent balance
                            {walletState.namada.account && (
                              <span className="text-muted-foreground font-normal ml-2 font-mono">
                                ({walletState.namada.account.slice(0, 8)}...{walletState.namada.account.slice(-4)})
                              </span>
                            )}
                          </span>
                          {!walletState.namada.isConnected && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Connect your Namada wallet to use this option
                            </p>
                          )}
                        </div>
                      </label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem
                        value="custom"
                        id="custom"
                        disabled={isAnyTxActive}
                        className="mt-0.5"
                      />
                      <label
                        htmlFor="custom"
                        className="flex-1 cursor-pointer"
                      >
                        <span className="text-sm font-medium">Set a custom recipient</span>
                      </label>
                    </div>
                  </RadioGroup>

                  {/* Show address input only when custom recipient is selected */}
                  {depositRecipientType === 'custom' && (
                    <RecipientAddressInput
                      value={toAddress}
                      onChange={setToAddress}
                      onNameChange={setRecipientName}
                      onNameValidationChange={(_isValid, error) => setNameValidationError(error)}
                      addressType="namada"
                      validationError={validation.addressError}
                      autoFillAddress={walletState.namada.account}
                      onAutoFill={handleAutoFill}
                      disabled={isAnyTxActive}
                    />
                  )}

                  {depositRecipientType === 'transparent' && !walletState.namada.isConnected && (
                    <div className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-warning" />
                        <p className="text-sm text-foreground">
                          Please connect your Namada wallet to deposit to your transparent balance, or select "Use a custom recipient" to enter an address manually.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Validation error for transparent address */}
                  {depositRecipientType === 'transparent' && validation.addressError && toAddress.trim() !== '' && (
                    <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span className="flex-1">{validation.addressError}</span>
                    </div>
                  )}
                  <div className="mt-3 rounded-md border border-muted/60 bg-muted/10 px-3 py-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-2 flex-1">
                        <p className="text-xs font-semibold text-foreground">Noble fallback address</p>
                        <p className="text-xs text-muted-foreground">
                          Used if the auto-forward from Noble to Namada needs to refund.
                        </p>

                        {/* Display selected address */}
                        {depositFallbackSelection.address && (
                          <div className="text-xs break-all text-foreground/90 mt-2">
                            <span>Current: </span>
                            <span className="font-mono">{depositFallbackSelection.address}</span>
                          </div>
                        )}
                        
                        {/* Radio button selection */}
                        <RadioGroup
                          value={depositFallbackSelection.source === 'none' ? undefined : depositFallbackSelection.source}
                          onValueChange={(value) => {
                            if (value === 'custom') {
                              const customAddress = loadNobleFallbackAddress()
                              if (customAddress) {
                                setDepositFallbackSelection({ source: 'custom', address: customAddress })
                              }
                            } else if (value === 'derived') {
                              const currentEvmAddress = walletState.metaMask.account
                              if (currentEvmAddress) {
                                const derivedAddress = loadDerivedFallbackAddress(currentEvmAddress)
                                if (derivedAddress) {
                                  setDepositFallbackSelection({ source: 'derived', address: derivedAddress })
                                }
                              }
                            }
                          }}
                          className="flex flex-col gap-2 mt-2"
                        >
                          <div className="flex items-center gap-2">
                            <RadioGroupItem
                              value="custom"
                              id="fallback-custom"
                              disabled={!loadNobleFallbackAddress()}
                              className="h-3.5 w-3.5"
                            />
                            <label
                              htmlFor="fallback-custom"
                              className={`text-xs cursor-pointer ${!loadNobleFallbackAddress() ? 'text-muted-foreground' : ''}`}
                            >
                              Use custom address from Settings {!loadNobleFallbackAddress() && '(not set)'}
                            </label>
                          </div>
                          <div className="flex items-center gap-2">
                            <RadioGroupItem
                              value="derived"
                              id="fallback-derived"
                              disabled={!walletState.metaMask.account || !loadDerivedFallbackAddress(walletState.metaMask.account || '')}
                              className="h-3.5 w-3.5"
                            />
                            <label
                              htmlFor="fallback-derived"
                              className={`text-xs cursor-pointer ${!walletState.metaMask.account || !loadDerivedFallbackAddress(walletState.metaMask.account || '') ? 'text-muted-foreground' : ''}`}
                            >
                              Use an address derived from my MetaMask account private key
                            </label>
                          </div>
                        </RadioGroup>

                        {/* Derivation status messages */}
                        {derivationState.stage === 'signing' && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            <span>Requesting signature...</span>
                          </div>
                        )}
                        {derivationState.stage === 'extracting' && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            <span>Extracting public key...</span>
                          </div>
                        )}
                        {derivationState.stage === 'deriving' && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            <span>Deriving Noble address...</span>
                          </div>
                        )}
                        {derivationState.stage === 'success' && (
                          <div className="flex items-center gap-2 text-xs text-success mt-1">
                            <CheckCircle2 className="h-3 w-3" />
                            <span>Address derived successfully</span>
                          </div>
                        )}
                        {derivationState.stage === 'error' && derivationState.error && (
                          <div className="flex flex-col gap-2 mt-1">
                            <div className="flex items-start gap-2 text-xs text-destructive">
                              <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
                              <span className="flex-1">{derivationState.error}</span>
                            </div>
                            {walletState.metaMask.isConnected && walletState.metaMask.account && (
                              <Button
                                type="button"
                                variant="secondary"
                                onClick={handleDeriveFallbackFromMetaMask}
                                disabled={derivationState.isLoading || isAnyTxActive}
                                className="text-xs h-7 px-2 w-fit"
                              >
                                Try again
                              </Button>
                            )}
                          </div>
                        )}

                        {/* Derive button - show when no derived address available */}
                        {walletState.metaMask.isConnected && walletState.metaMask.account && !loadDerivedFallbackAddress(walletState.metaMask.account) && derivationState.stage === 'idle' && (
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={handleDeriveFallbackFromMetaMask}
                            disabled={derivationState.isLoading || isAnyTxActive}
                            className="text-xs h-7 px-3 mt-2"
                          >
                            {derivationState.isLoading ? (
                              <>
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Deriving...
                              </>
                            ) : (
                              'Derive now'
                            )}
                          </Button>
                        )}
                      </div>
                      {depositFallbackSelection.address && (
                        <CopyButton
                          text={depositFallbackSelection.address}
                          label="Fallback address"
                          size="sm"
                          className="hover:bg-muted/60"
                        />
                      )}
                    </div>
                    {/* Warning when no fallback */}
                    {depositFallbackSelection.source === 'none' && (
                          <div className="flex items-start gap-2 text-xs text-warning mt-2 p-2 rounded border border-warning/30 bg-warning/10">
                            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            <span className="flex-1">
                              No fallback address configured. Set one in{' '}
                              <Link to="/settings" className="font-medium underline hover:text-warning/80">
                                Settings
                              </Link>
                              {' '}or derive from your MetaMask account. Proceeding without a fallback address may result in lost funds.
                            </span>
                          </div>
                        )}
                  </div>
                  {/* Noble forwarding registration status */}
                  {!validation.addressError && toAddress.trim() !== '' && (
                    <div className="mt-3">
                      {registrationStatus.isLoading && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>Checking registration status...</span>
                        </div>
                      )}
                      {!registrationStatus.isLoading && registrationStatus.isRegistered === true && (
                        <div className="card">
                          <div className="flex items-start gap-3">
                            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-info" />
                            <div className="flex-1 space-y-2">
                              <p className="text-sm text-foreground">Noble forwarding address is already registered</p>
                              {registrationStatus.forwardingAddress && (
                                <div className="flex items-center gap-2 pt-2 border-t border-info/20">
                                  <span className="font-mono text-xs text-muted-foreground break-all">
                                    {registrationStatus.forwardingAddress}
                                  </span>
                                  <CopyButton
                                    text={registrationStatus.forwardingAddress!}
                                    label="Forwarding address"
                                    size="sm"
                                    className="hover:bg-info/20"
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                      {!registrationStatus.isLoading && registrationStatus.isRegistered === false && (
                        <div className="card card-warning">
                          <div className="flex items-start gap-3">
                            <Info className="h-4 w-4 shrink-0 mt-0.5 text-warning" />
                            <div className="flex-1 space-y-2">
                              <p className="text-sm text-foreground">Noble forwarding address not yet registered. A $0.02 registration fee will be included.</p>
                              {registrationStatus.forwardingAddress && (
                                <div className="flex items-center gap-2 pt-2 border-t border-warning/20">
                                  <span className="font-mono text-xs text-muted-foreground break-all">
                                    {registrationStatus.forwardingAddress}
                                  </span>
                                  <CopyButton
                                    text={registrationStatus.forwardingAddress!}
                                    label="Forwarding address"
                                    size="sm"
                                    className="hover:bg-warning/20"
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                      {!registrationStatus.isLoading && registrationStatus.error && (
                        <div className="card card-warning">
                          <div className="flex items-start gap-3">
                            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-warning" />
                            <div className="flex-1 space-y-1">
                              <p className="text-sm font-medium text-foreground">Could not determine forwarding address registration status</p>
                              <p className="text-sm text-muted-foreground">
                                If the forwarding address is not registered, your funds may become stuck and require further action on Noble chain for retrieval. Proceed at your own risk.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  </div>

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
                <div className="space-y-3 mx-auto my-8">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Network fee</span>
                    {isEstimatingFee ? (
                      <div className="flex items-center gap-1.5">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">Estimating...</span>
                      </div>
                    ) : feeInfo ? (
                      <span className="text-sm font-semibold">{estimatedFee}</span>
                    ) : (
                      <span className="text-sm text-muted-foreground">--</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between border-t border-border pt-3 space-x-24 ">
                    <span className="text-base font-semibold">Total amount deducted</span>
                    <span className="text-xl font-bold">${total}</span>
                  </div>
                </div>

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
