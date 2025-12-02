/**
 * Shielding modal component for initiating shielding transactions.
 */

import { useState, useEffect, type FormEvent } from 'react'
import { X, Loader2, AlertCircle, CheckCircle2, Lock, ExternalLink } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { useShielding } from '@/hooks/useShielding'
import { useBalance } from '@/hooks/useBalance'
import { useShieldingFeeEstimate } from '@/hooks/useShieldingFeeEstimate'
import { useAtomValue } from 'jotai'
import { walletAtom } from '@/atoms/walletAtom'
import { validateShieldAmount, handleAmountInputChange } from '@/services/validation'
import { formatTxHash } from '@/utils/toastHelpers'
import { getNamadaTxExplorerUrl } from '@/utils/explorerUtils'
import { cn } from '@/lib/utils'

export interface ShieldingModalProps {
  open: boolean
  onClose: () => void
}

export function ShieldingModal({ open, onClose }: ShieldingModalProps) {
  const { state: balanceState } = useBalance()
  const walletState = useAtomValue(walletAtom)
  const { state: shieldingState, shield, reset } = useShielding()
  const [amount, setAmount] = useState('')
  const [isConfirming, setIsConfirming] = useState(false)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [explorerUrl, setExplorerUrl] = useState<string | undefined>(undefined)

  // Use unified fee estimation hook (same logic as prepareShieldingParams)
  const { state: feeEstimateState } = useShieldingFeeEstimate(
    amount,
    walletState.namada.account,
  )

  // Reset form when modal closes
  useEffect(() => {
    if (!open) {
      setAmount('')
      setIsConfirming(false)
      setTxHash(null)
      setExplorerUrl(undefined)
      reset()
    }
  }, [open, reset])

  // Handle Escape key to close modal
  useEffect(() => {
    if (!open) return

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isConfirming && !shieldingState.isShielding) {
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open, onClose, isConfirming, shieldingState.isShielding])

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
  const amountValidation = validateShieldAmount(amount, transparentBalance)
  const isAmountValid = amountValidation.isValid
  const amountError = amountValidation.error

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()

    // Validate form
    if (!isAmountValid) {
      return
    }

    setIsConfirming(true)
    setTxHash(null)
    setExplorerUrl(undefined)
    const result = await shield(amount)

    if (result) {
      setTxHash(result.txHash)
      // Fetch explorer URL
      getNamadaTxExplorerUrl(result.txHash).then((url) => {
        setExplorerUrl(url)
      }).catch(() => {
        // Silently fail if explorer URL can't be fetched
      })
      // Don't auto-close - let user close manually after reviewing success state
      setIsConfirming(false)
    } else {
      setIsConfirming(false)
    }
  }

  const handleRetry = () => {
    reset()
    setIsConfirming(false)
    setTxHash(null)
    setExplorerUrl(undefined)
  }

  const handleMaxClick = () => {
    setAmount(transparentBalance)
  }

  const isDisabled = shieldingState.isShielding || isConfirming || !isAmountValid

  const isTransactionActive = shieldingState.isShielding || isConfirming
  const shouldShowDetails = amount && (isAmountValid || isTransactionActive)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className={cn(
          "absolute inset-0 backdrop-blur-sm transition-all",
          isTransactionActive ? "bg-black/70 backdrop-blur-md" : "bg-black/60 backdrop-blur-sm"
        )}
        onClick={!isConfirming && !shieldingState.isShielding ? onClose : undefined}
        aria-hidden="true"
      />

      {/* Modal Content */}
      <div className={cn(
        "relative z-50 w-full max-w-md rounded-lg border bg-background p-6 shadow-lg transition-all",
        isTransactionActive && "border-primary/50"
      )}>
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Shield USDC</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isConfirming || shieldingState.isShielding}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label={isTransactionActive ? "Modal locked during transaction" : "Close modal"}
          >
            {isTransactionActive ? (
              <Lock className="h-5 w-5" />
            ) : (
              <X className="h-5 w-5" />
            )}
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Amount Input */}
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
                disabled={shieldingState.isShielding || isConfirming}
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
                disabled={shieldingState.isShielding || isConfirming}
                className="text-xs"
              >
                MAX
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Available: {transparentBalance} USDC</span>
              </div>
              {amountError && amount.trim() !== '' && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span className="flex-1">{amountError}</span>
                </div>
              )}
            </div>
          </div>

          {/* Transaction Details */}
          {shouldShowDetails && (
            <div className={cn(
              "rounded-lg border bg-muted/40 p-4 transition-all",
              isTransactionActive ? "border-primary/50 opacity-60" : "border-border"
            )}>
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

          {/* Progress Stepper */}
          {shieldingState.isShielding && (
            <div className="flex items-center justify-between px-2 py-4">
              {(['building', 'signing', 'submitting'] as const).map((phase, idx) => {
                const isActive = shieldingState.phase === phase
                const phaseIndex = ['building', 'signing', 'submitting'].indexOf(shieldingState.phase || '')
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

          {/* Status Messages */}
          {shieldingState.phase && (
            <div className="rounded-lg border border-border bg-muted/40 p-3 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="flex items-center gap-2 text-sm">
                {shieldingState.isShielding && <Loader2 className="h-4 w-4 animate-spin" />}
                <span>
                  {shieldingState.phase === 'building' && 'Building transaction...'}
                  {shieldingState.phase === 'signing' && 'Waiting for approval...'}
                  {shieldingState.phase === 'submitting' && 'Submitting transaction...'}
                  {shieldingState.phase === 'submitted' && 'Transaction submitted successfully!'}
                </span>
              </div>
            </div>
          )}

          {/* Enhanced Success State */}
          {shieldingState.phase === 'submitted' && txHash && (
            <div className="rounded-lg border border-green-500/50 bg-green-500/10 p-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-green-700 dark:text-green-400 mb-1">
                    Transaction submitted successfully!
                  </p>
                  <div className="flex items-center gap-2 mt-2">
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
                </div>
              </div>
            </div>
          )}

          {shieldingState.error && (
            <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm text-red-500 mb-2">{shieldingState.error}</p>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleRetry}
                    className="h-7 text-xs"
                  >
                    Try Again
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Footer Actions */}
          <div className="mt-6 flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={isConfirming || shieldingState.isShielding}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={isDisabled}
              className={cn(
                isDisabled && "cursor-not-allowed opacity-60",
                shieldingState.isShielding && "animate-pulse"
              )}
            >
              {shieldingState.isShielding ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  <span className="transition-opacity duration-200">
                    {shieldingState.phase === 'building' && 'Building...'}
                    {shieldingState.phase === 'signing' && 'Signing...'}
                    {shieldingState.phase === 'submitting' && 'Submitting...'}
                    {!shieldingState.phase && 'Processing...'}
                  </span>
                </>
              ) : (
                'Shield'
              )}
            </Button>
          </div>
        </form>

        {/* Success Celebration Animation */}
        {shieldingState.phase === 'submitted' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="animate-in zoom-in-95 duration-500 fade-out duration-300 delay-[800ms]">
              <CheckCircle2 className="h-16 w-16 text-green-500" />
            </div>
          </div>
        )}

        {/* ARIA Live Region for Screen Readers */}
        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {shieldingState.phase && (
            <span>
              {shieldingState.phase === 'building' && 'Building transaction'}
              {shieldingState.phase === 'signing' && 'Waiting for wallet approval'}
              {shieldingState.phase === 'submitting' && 'Submitting transaction'}
              {shieldingState.phase === 'submitted' && 'Transaction submitted successfully'}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

