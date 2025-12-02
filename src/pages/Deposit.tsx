import { useState, useEffect, useRef, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSetAtom, useAtomValue } from 'jotai'
import { Loader2, Wallet, ArrowRight, AlertCircle, CheckCircle2, Info, Copy } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { BackToHome } from '@/components/common/BackToHome'
import { ChainSelect } from '@/components/common/ChainSelect'
import { DepositConfirmationModal } from '@/components/deposit/DepositConfirmationModal'
import { useWallet } from '@/hooks/useWallet'
import { useBalance } from '@/hooks/useBalance'
import { useToast } from '@/hooks/useToast'
import { RequireMetaMaskConnection } from '@/components/wallet/RequireMetaMaskConnection'
import { validateDepositForm, handleAmountInputChange, handleBech32InputChange, validateNamadaAddress } from '@/services/validation'
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
import { preferredChainKeyAtom, depositRecipientAddressAtom } from '@/atoms/appAtom'
import { findChainByChainId, getDefaultChainKey } from '@/config/chains'

export function Deposit() {
  const navigate = useNavigate()
  const { upsertTransaction } = useTxTracker({ enablePolling: false })
  const { notify, updateToast } = useToast()
  const { state: walletState } = useWallet()
  const { state: balanceState, refresh, sync: balanceSync } = useBalance()
  const preferredChainKey = useAtomValue(preferredChainKeyAtom)
  const setPreferredChainKey = useSetAtom(preferredChainKeyAtom)
  const setDepositRecipientAddress = useSetAtom(depositRecipientAddressAtom)

  // Form state
  const [amount, setAmount] = useState('')
  const [toAddress, setToAddress] = useState('')
  const [selectedChain, setSelectedChain] = useState<string | undefined>(undefined)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showConfirmationModal, setShowConfirmationModal] = useState(false)

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

  // Sync toAddress to global atom so it can be accessed from anywhere
  useEffect(() => {
    setDepositRecipientAddress(toAddress || undefined)
  }, [toAddress, setDepositRecipientAddress])

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
        const status = await checkCurrentDepositRecipientRegistration(addressToCheck)
        
        // Only update if we're still checking the same address
        if (checkingAddressRef.current === addressToCheck) {
          setRegistrationStatus({
            isLoading: false,
            isRegistered: status.exists,
            forwardingAddress: status.address || null,
            error: null,
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
  }, [toAddress])

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

    // Show confirmation modal
    setShowConfirmationModal(true)
  }

  // Handle confirmation and submit transaction
  async function handleConfirmDeposit(): Promise<void> {
    setShowConfirmationModal(false)
    setIsSubmitting(true)

    // Track transaction state for error handling
    let tx: Awaited<ReturnType<typeof buildDepositTransaction>> | undefined
    let signedTx: Awaited<ReturnType<typeof signDepositTransaction>> | undefined
    let currentTx: StoredTransaction | undefined

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

      // Use a consistent toast ID for transaction status updates
      const txToastId = `deposit-tx-${Date.now()}`

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

      // Sign transaction
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

      // Broadcast transaction
      updateToast(txToastId, buildTransactionStatusToast('broadcasting', 'deposit'))
      
      // Update status to submitting before broadcast
      currentTx = {
        ...currentTx,
        status: 'submitting',
        updatedAt: Date.now(),
      }
      transactionStorageService.saveTransaction(currentTx)
      
      const txHash = await broadcastDepositTransaction(signedTx)

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

      // Navigate to Dashboard
      navigate('/dashboard')
    } catch (error) {
      console.error('[Deposit] Deposit submission failed:', error)
      const message = error instanceof Error ? error.message : 'Failed to submit deposit'
      
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
        icon: <Info className="h-5 w-5" />,
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
      <div className="flex flex-col gap-6 p-24 max-w-[1024px] mx-auto w-full">
        <BackToHome />

        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Deposit USDC</h1>
          <p className="text-muted-foreground">
            Deposit USDC from an EVM chain to your Namada address.
          </p>
        </header>

        {/* EVM Balance Card */}
        <div className="rounded-lg border border-blue-200/50 bg-gradient-to-br from-blue-50/50 to-blue-100/30 dark:from-blue-950/20 dark:to-blue-900/10 dark:border-blue-800/50 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-500/20 dark:bg-blue-600/20">
                <Wallet className="h-5 w-5 text-blue-600 dark:text-blue-500" />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Available Balance</p>
                <div className="flex items-center gap-2 mt-1">
                  <p className="text-xl font-bold">{availableBalance} <span className="text-base font-semibold text-muted-foreground">USDC</span></p>
                  {isEvmBalanceLoading && (
                    <Loader2 className="h-4 w-4 animate-spin text-blue-500" aria-label="Loading balance" />
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

          {/* To Namada Address Section */}
          <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
            <div className="flex items-baseline justify-between mb-3">
              <label className="text-sm font-medium text-muted-foreground">Recipient Address</label>
              <button
                type="button"
                onClick={handleAutoFill}
                disabled={!walletState.namada.isConnected || isSubmitting}
                className={`text-sm font-medium text-primary hover:text-primary/80 transition-colors ${
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
              onChange={(e) => handleBech32InputChange(e, setToAddress)}
              className={`w-full rounded-lg border bg-background px-4 py-3 text-sm font-mono shadow-sm focus-visible:outline-none focus-visible:ring-2 transition-colors ${
                validation.addressError && toAddress.trim() !== ''
                  ? 'border-destructive focus-visible:ring-destructive/20 focus-visible:border-destructive'
                  : 'border-input focus-visible:ring-ring focus-visible:border-ring'
              }`}
              placeholder="tnam..."
              disabled={isSubmitting}
            />
            {/* Validation error for address */}
            {validation.addressError && toAddress.trim() !== '' && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span className="flex-1">{validation.addressError}</span>
              </div>
            )}
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
                  <div className="rounded-md border border-green-500/50 bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-400">
                    <div className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                      <div className="flex-1 space-y-1">
                        <p>Noble forwarding address is already registered</p>
                        {registrationStatus.forwardingAddress && (
                          <div className="flex items-center gap-2 mt-2 pt-2 border-t border-green-500/20">
                            <span className="font-mono text-xs opacity-90 break-all">
                              {registrationStatus.forwardingAddress}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(registrationStatus.forwardingAddress!)
                                notify(buildCopySuccessToast('Forwarding address'))
                              }}
                              className="rounded p-1 text-green-700 dark:text-green-400 hover:bg-green-500/20 transition-colors shrink-0"
                              aria-label="Copy forwarding address"
                              title="Copy forwarding address"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                {!registrationStatus.isLoading && registrationStatus.isRegistered === false && (
                  <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
                    <div className="flex items-start gap-2">
                      <Info className="h-4 w-4 shrink-0 mt-0.5" />
                      <div className="flex-1 space-y-1">
                        <p>Noble forwarding address not yet registered. A $0.02 registration fee will be included.</p>
                        {registrationStatus.forwardingAddress && (
                          <div className="flex items-center gap-2 mt-2 pt-2 border-t border-amber-500/20">
                            <span className="font-mono text-xs opacity-90 break-all">
                              {registrationStatus.forwardingAddress}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(registrationStatus.forwardingAddress!)
                                notify(buildCopySuccessToast('Forwarding address'))
                              }}
                              className="rounded p-1 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20 transition-colors shrink-0"
                              aria-label="Copy forwarding address"
                              title="Copy forwarding address"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                {!registrationStatus.isLoading && registrationStatus.error && (
                  <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span className="flex-1">Unable to check registration status: {registrationStatus.error}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Chain Select Component */}
          <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
            <label className="block text-sm font-medium text-muted-foreground mb-3">Source Chain</label>
            <ChainSelect
              value={selectedChain}
              onChange={setSelectedChain}
              disabled={isSubmitting}
              showEstimatedTime={true}
              timeType="deposit"
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
                <span className="text-sm font-semibold">{estimatedFee}</span>
              ) : (
                <span className="text-sm text-muted-foreground">--</span>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-border pt-3">
              <span className="text-base font-semibold">Total</span>
              <span className="text-xl font-bold">${total}</span>
            </div>
          </div>

          {/* Action Button */}
          <Button
            type="submit"
            variant="primary"
            className="w-full py-6 text-lg font-semibold gap-2"
            disabled={!validation.isValid || isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <ArrowRight className="h-5 w-5" />
                Deposit Now
              </>
            )}
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
