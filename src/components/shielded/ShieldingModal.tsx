/**
 * Shielding modal component for initiating shielding transactions.
 */

import { useState, useEffect, useMemo, type FormEvent } from 'react'
import { X, Loader2, AlertCircle, CheckCircle2, Lock, ExternalLink, XCircle } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { useShielding } from '@/hooks/useShielding'
import { useBalance } from '@/hooks/useBalance'
import { useShieldingFeeEstimate } from '@/hooks/useShieldingFeeEstimate'
import { useAtomValue } from 'jotai'
import { walletAtom } from '@/atoms/walletAtom'
import { txUiAtom, isAnyTransactionActiveAtom } from '@/atoms/txUiAtom'
import { validateShieldAmount, handleAmountInputChange } from '@/services/validation'
import { formatTxHash } from '@/utils/toastHelpers'
import { cn } from '@/lib/utils'

export interface ShieldingModalProps {
  open: boolean
  onClose: () => void
}

type ModalState = 
  | 'idle'           // Form ready for input
  | 'validating'     // User typing, validation running
  | 'submitting'     // Transaction in progress (building/signing/submitting)
  | 'success'         // Transaction completed successfully
  | 'error'           // Transaction failed

export function ShieldingModal({ open, onClose }: ShieldingModalProps) {
  const { state: balanceState } = useBalance()
  const walletState = useAtomValue(walletAtom)
  const { state: shieldingState, shield, reset } = useShielding()
  const txUiState = useAtomValue(txUiAtom)
  const isAnyTxActive = useAtomValue(isAnyTransactionActiveAtom)
  const [amount, setAmount] = useState('')
  const [_isConfirming, setIsConfirming] = useState(false)
  
  // Use global state for txHash and explorerUrl
  const txHash = txUiState.txHash
  const explorerUrl = txUiState.explorerUrl

  // Use unified fee estimation hook (same logic as prepareShieldingParams)
  const { state: feeEstimateState } = useShieldingFeeEstimate(
    amount,
    walletState.namada.account,
  )

  // Derive unified modal state from existing atoms (must be before useEffects that use it)
  const modalState = useMemo<ModalState>(() => {
    // Error state: transaction failed and not currently active
    if (shieldingState.error && !isAnyTxActive) {
      return 'error'
    }
    
    // Success state: transaction completed successfully
    if (txUiState.showSuccessState && txUiState.txHash) {
      return 'success'
    }
    
    // Submitting state: transaction in progress
    if (isAnyTxActive && !txUiState.showSuccessState) {
      return 'submitting'
    }
    
    // Validating state: user has entered amount
    if (amount.length > 0) {
      return 'validating'
    }
    
    // Idle state: form ready for input
    return 'idle'
  }, [isAnyTxActive, txUiState.showSuccessState, txUiState.txHash, shieldingState.error, amount.length])

  // Reset form when modal closes (only if transaction is not active)
  useEffect(() => {
    if (!open && !isAnyTxActive) {
      setAmount('')
      setIsConfirming(false)
      reset()
    }
  }, [open, reset, isAnyTxActive])

  // Handle Escape key to close modal (prevent if transaction is submitting)
  useEffect(() => {
    if (!open) return

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && modalState !== 'submitting') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open, onClose, modalState])

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }

    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  if (!open) {
    return null
  }

  const transparentBalance = balanceState.namada.usdcTransparent || '0.00'

  // Get fee information from hook (already calculated, no logic in modal)
  const feeInfo = feeEstimateState.feeInfo
  const isEstimatingFee = feeEstimateState.isLoading

  // Validate amount using new validation service
  // Include fee information to check if amount is less than fees
  const amountValidation = validateShieldAmount(amount, transparentBalance, {
    feeAmount: feeInfo?.feeToken === 'USDC' ? feeInfo.feeAmount : undefined,
    feeToken: feeInfo?.feeToken,
  })
  const isAmountValid = amountValidation.isValid
  const amountError = amountValidation.error

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()

    // Validate form
    if (!isAmountValid) {
      return
    }

    // Prevent starting new transaction if any transaction is active
    if (isAnyTxActive) {
      return
    }

    setIsConfirming(true)
    const result = await shield(amount)

    if (result) {
      // txHash and explorerUrl are now managed in global state by useShielding hook
      // Don't auto-close - let user close manually after reviewing success state
      setIsConfirming(false)
    } else {
      setIsConfirming(false)
    }
  }

  const handleRetry = () => {
    setAmount('')
    setIsConfirming(false)
    reset()
  }

  const handleNewTransaction = () => {
    setAmount('')
    setIsConfirming(false)
    reset()
  }

  const handleMaxClick = () => {
    setAmount(transparentBalance)
  }

  // Determine which parts of the form should be visible
  const showFormInputs = modalState === 'idle' || modalState === 'validating'
  const showValidationError = showFormInputs && amountError && amount.trim() !== ''
  const showTransactionDetails = showFormInputs && amount && (isAmountValid || amount.length > 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className={cn(
          "absolute inset-0 backdrop-blur-sm transition-all",
          modalState === 'submitting' ? "bg-black/70 backdrop-blur-md" : "bg-black/60 backdrop-blur-sm"
        )}
        onClick={modalState !== 'submitting' ? onClose : undefined}
        aria-hidden="true"
      />

      {/* Modal Content */}
      <div className={cn(
        "relative z-50 w-full max-w-md rounded-lg border bg-background p-6 shadow-lg transition-all",
        modalState === 'submitting' && "border-primary/50"
      )}>
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Shield USDC</h2>
          {modalState !== 'submitting' && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label="Close modal"
            >
              <X className="h-5 w-5" />
            </button>
          )}
          {modalState === 'submitting' && (
            <div className="rounded-md p-1 text-muted-foreground" aria-label="Modal locked during transaction">
              <Lock className="h-5 w-5" />
            </div>
          )}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Amount Input - Only show during idle/validating states */}
          {showFormInputs && (
            <div className="space-y-2">
              <label htmlFor="amount" className="text-sm font-medium">
                Amount (USDC)
              </label>
              <div className="relative flex items-center gap-2">
                <input
                  id="amount"
                  type="text"
                  value={amount}
                  onChange={(e) => handleAmountInputChange(e, setAmount, 6)}
                  disabled={modalState !== 'idle' && modalState !== 'validating'}
                  placeholder="0.00"
                  inputMode="decimal"
                  className={cn(
                    "flex-1 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 transition-colors disabled:opacity-50",
                    isEstimatingFee && "pr-8",
                    amountError && amount.trim() !== ''
                      ? 'border-destructive focus:ring-destructive/20 focus:border-destructive'
                      : 'border-border focus:ring-ring'
                  )}
                />
                {isEstimatingFee && (
                  <Loader2 className="absolute right-3 h-3 w-3 animate-spin text-muted-foreground pointer-events-none" />
                )}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleMaxClick}
                  disabled={modalState !== 'idle' && modalState !== 'validating'}
                  className="text-xs"
                >
                  MAX
                </Button>
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Available: {transparentBalance} USDC</span>
                </div>
                {showValidationError && (
                  <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span className="flex-1">{amountError}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Transaction Details - Only show during idle/validating states */}
          {showTransactionDetails && (
            <div className="rounded-lg border bg-muted/40 p-4 transition-all border-border">
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">From</span>
                  <span className="font-medium">Transparent</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">To</span>
                  <span className="font-medium">Shielded</span>
                </div>
                <div className="flex items-center justify-between border-t border-border pt-2">
                  <span className="text-muted-foreground">Amount</span>
                  <span className="font-semibold">{amount} USDC</span>
                </div>
                {/* Estimated Fee */}
                {isEstimatingFee ? (
                  <div className="flex items-center justify-between border-t border-border pt-2">
                    <span className="text-muted-foreground">Fee</span>
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span className="text-xs text-muted-foreground">Estimating...</span>
                    </div>
                  </div>
                ) : feeInfo ? (
                  <>
                    <div className="flex items-center justify-between border-t border-border pt-2">
                      <span className="text-muted-foreground">Fee</span>
                      <span className="font-medium">
                        {feeInfo.feeAmount} {feeInfo.feeToken}
                      </span>
                    </div>
                    {/* Final Amount (after fees) */}
                    <div className="flex items-center justify-between border-t border-border pt-2">
                      <span className="text-muted-foreground">Amount Shielded</span>
                      <span className="font-semibold text-green-600">{feeInfo.finalAmount} USDC</span>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          )}

          {/* Progress Stepper - Only show during submitting state */}
          {modalState === 'submitting' && (
            <div className="flex items-center justify-between px-2 py-4">
              {(['building', 'signing', 'submitting'] as const).map((phase, idx) => {
                const isActive = txUiState.phase === phase
                const phaseIndex = ['building', 'signing', 'submitting'].indexOf(txUiState.phase || '')
                const isComplete = phaseIndex > idx
                return (
                  <div key={phase} className="flex items-center flex-1">
                    <div className="flex flex-col items-center flex-1">
                      <div className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium transition-all",
                        isComplete && "bg-green-500 text-white",
                        isActive && "bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2",
                        !isActive && !isComplete && "bg-muted text-muted-foreground"
                      )}>
                        {isComplete ? <CheckCircle2 className="h-4 w-4" /> : idx + 1}
                      </div>
                      <span className={cn(
                        "text-xs mt-1 text-center",
                        isActive && "font-medium text-foreground",
                        !isActive && "text-muted-foreground"
                      )}>
                        {phase === 'building' && 'Build'}
                        {phase === 'signing' && 'Sign'}
                        {phase === 'submitting' && 'Submit'}
                      </span>
                    </div>
                    {idx < 2 && (
                      <div className={cn(
                        "h-0.5 flex-1 mx-2 transition-colors",
                        isComplete ? "bg-green-500" : "bg-muted"
                      )} />
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Status Messages - Only show during submitting state */}
          {modalState === 'submitting' && txUiState.phase && (
            <div className="rounded-lg border border-border bg-muted/40 p-3 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>
                  {txUiState.phase === 'building' && 'Building transaction...'}
                  {txUiState.phase === 'signing' && 'Waiting for approval...'}
                  {txUiState.phase === 'submitting' && 'Submitting transaction...'}
                </span>
              </div>
            </div>
          )}

          {/* Enhanced Success State */}
          {modalState === 'success' && txHash && (
            <div className="space-y-4">
              {/* Success Checkmark */}
              <div className="flex justify-center animate-in zoom-in-95 duration-500">
                <CheckCircle2 className="h-16 w-16 text-green-500" />
              </div>
              
              {/* Success Message */}
              <div className="rounded-lg border border-green-500/50 bg-green-500/10 p-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="flex flex-col gap-4">
                  <p className="text-sm font-medium text-green-700 dark:text-green-400 text-center">
                    Transaction submitted successfully!
                  </p>
                  <div className="flex items-center justify-center gap-2">
                    <code className="text-xs font-mono text-green-600 dark:text-green-300">
                      {formatTxHash(txHash)}
                    </code>
                    {explorerUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => window.open(explorerUrl, '_blank', 'noopener,noreferrer')}
                        className="h-6 px-2 text-xs"
                      >
                        <ExternalLink className="h-3 w-3 mr-1" />
                        View on Explorer
                      </Button>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <Button
                      type="button"
                      variant="primary"
                      onClick={handleNewTransaction}
                      className="flex-1"
                    >
                      New Transaction
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={onClose}
                      className="flex-1"
                    >
                      Close
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Error State */}
          {modalState === 'error' && shieldingState.error && (
            <div className="space-y-4">
              {/* Error X Icon */}
              <div className="flex justify-center animate-in zoom-in-95 duration-500">
                <XCircle className="h-16 w-16 text-red-500" />
              </div>
              
              {/* Error Message */}
              <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-4 animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="flex flex-col gap-4">
                  <p className="text-sm text-red-500 text-center">{shieldingState.error}</p>
                  <div className="flex items-center gap-3">
                    <Button
                      type="button"
                      variant="primary"
                      onClick={handleRetry}
                      className="flex-1"
                    >
                      Try Again
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={onClose}
                      className="flex-1"
                    >
                      Close
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Footer Actions - Only show during idle/validating states */}
          {showFormInputs && (
            <div className="mt-6 flex items-center justify-end gap-3">
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={modalState === 'idle' || (modalState === 'validating' && !isAmountValid)}
                className={cn(
                  (modalState === 'idle' || (modalState === 'validating' && !isAmountValid)) && "cursor-not-allowed opacity-60"
                )}
              >
                Shield
              </Button>
            </div>
          )}
        </form>

        {/* ARIA Live Region for Screen Readers */}
        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {txUiState.phase && (
            <span>
              {txUiState.phase === 'building' && 'Building transaction'}
              {txUiState.phase === 'signing' && 'Waiting for wallet approval'}
              {txUiState.phase === 'submitting' && 'Submitting transaction'}
            </span>
          )}
          {txUiState.showSuccessState && (
            <span>Transaction submitted successfully</span>
          )}
        </div>
      </div>
    </div>
  )
}

