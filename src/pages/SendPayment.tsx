import { useState, useEffect, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { DollarSign, Loader2 } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { RequireNamadaConnection } from '@/components/wallet/RequireNamadaConnection'
import { ChainSelect } from '@/components/common/ChainSelect'
import { PaymentConfirmationModal } from '@/components/payment/PaymentConfirmationModal'
import { useBalance } from '@/hooks/useBalance'
import { useShieldedSync } from '@/hooks/useShieldedSync'
import { useWallet } from '@/hooks/useWallet'
import { useToast } from '@/hooks/useToast'
import { useAtomValue } from 'jotai'
import { balanceSyncAtom } from '@/atoms/balanceAtom'
import { validatePaymentForm } from '@/utils/paymentValidation'
import { usePaymentFeeEstimate } from '@/hooks/usePaymentFeeEstimate'
import {
  buildPaymentTransaction,
  signPaymentTransaction,
  broadcastPaymentTransaction,
  savePaymentMetadata,
  postPaymentToBackend,
  type PaymentTransactionDetails,
} from '@/services/payment/paymentService'
import { useTxTracker } from '@/hooks/useTxTracker'
import { flowStorageService } from '@/services/flow/flowStorageService'
import { fetchEvmChainsConfig } from '@/services/config/chainConfigService'

export function SendPayment() {
  const navigate = useNavigate()
  const { upsertTransaction } = useTxTracker()
  const { notify } = useToast()
  const { state: walletState } = useWallet()

  // Form state
  const [amount, setAmount] = useState('')
  const [toAddress, setToAddress] = useState('')
  const [selectedChain, setSelectedChain] = useState<string | undefined>(undefined)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showConfirmationModal, setShowConfirmationModal] = useState(false)

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
        console.error('[SendPayment] Failed to load chain name:', error)
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

      // Build transaction
      notify({ title: 'Building transaction...', level: 'info' })
      const tx = await buildPaymentTransaction({
        amount,
        destinationAddress: toAddress,
        destinationChain: selectedChain,
        transparentAddress,
        shieldedAddress,
      })

      // Sign transaction
      notify({ title: 'Signing transaction...', level: 'info' })
      const signedTx = await signPaymentTransaction(tx)

      // Broadcast transaction
      notify({ title: 'Broadcasting transaction...', level: 'info' })
      const txHash = await broadcastPaymentTransaction(signedTx)

      // Save metadata
      await savePaymentMetadata(txHash, transactionDetails)

      // Post to backend (registers flow with backend)
      const flowId = await postPaymentToBackend(txHash, transactionDetails)

      // Update transaction with flowId and flowMetadata
      if (flowId) {
        const flowInitiation = flowStorageService.getFlowInitiationByFlowId(flowId)
        if (flowInitiation) {
          const updatedTx = {
            ...signedTx,
            hash: txHash,
            flowId,
            flowMetadata: flowInitiation,
          }
          upsertTransaction(updatedTx)
        }
      } else {
        // Still track transaction even if flow registration failed
        const updatedTx = {
          ...signedTx,
          hash: txHash,
        }
        upsertTransaction(updatedTx)
      }

      // Show success toast
      notify({
        title: 'Payment Submitted',
        description: `Transaction ${txHash.slice(0, 10)}... submitted successfully`,
        level: 'success',
      })

      // Navigate to Dashboard
      navigate('/dashboard')
    } catch (error) {
      console.error('[SendPayment] Payment submission failed:', error)
      const message = error instanceof Error ? error.message : 'Failed to submit payment'
      notify({
        title: 'Payment Failed',
        description: message,
        level: 'error',
      })
    } finally {
      setIsSubmitting(false)
    }
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
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">of ${shieldedBalance}</span>
              {isShieldedBalanceLoading && (
                <Loader2
                  className="h-4 w-4 animate-spin text-blue-500"
                  aria-label="Loading shielded balance"
                />
              )}
            </div>
          </div>
        </div>

        {/* Validation error for amount */}
        {validation.amountError && (
          <div className="text-sm text-destructive">{validation.amountError}</div>
        )}

        <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
          {/* To Address Section */}
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <label className="text-sm font-medium text-muted-foreground">to</label>
              <button
                type="button"
                onClick={handleAutoFill}
                disabled={!walletState.metaMask.isConnected || isSubmitting}
                className={`text-sm text-muted-foreground hover:text-foreground ${
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
              onChange={(e) => setToAddress(e.target.value)}
              className="rounded-lg border border-input bg-background px-4 py-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="0x..."
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
            timeType="send"
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
                <span className="text-sm font-medium">
                  {feeInfo.feeToken === 'USDC'
                    ? `$${parseFloat(feeInfo.feeAmount).toFixed(2)}`
                    : `${parseFloat(feeInfo.feeAmount).toFixed(6)} NAM`}
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">--</span>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-border pt-2">
              <span className="text-sm font-medium">Total</span>
              <span className="text-sm font-semibold">
                {feeInfo && feeInfo.feeToken === 'USDC' ? `$${total}` : `$${amount || '0.00'}`}
              </span>
            </div>
          </div>

          {/* Action Button */}
          <Button
            type="submit"
            variant="primary"
            className="w-full py-6 text-lg"
            disabled={!validation.isValid || isSubmitting}
          >
            {isSubmitting ? 'Processing...' : 'Pay now'}
          </Button>
        </form>

        {/* Confirmation Modal */}
        <PaymentConfirmationModal
          open={showConfirmationModal}
          onClose={() => setShowConfirmationModal(false)}
          onConfirm={handleConfirmPayment}
          transactionDetails={transactionDetails}
        />
      </div>
    </RequireNamadaConnection>
  )
}
