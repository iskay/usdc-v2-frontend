/**
 * Shielding modal component for initiating shielding transactions.
 */

import { useState, useEffect, type FormEvent } from 'react'
import { X, Loader2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { useShielding } from '@/hooks/useShielding'
import { useBalance } from '@/hooks/useBalance'
import { useShieldingFeeEstimate } from '@/hooks/useShieldingFeeEstimate'
import { useAtomValue } from 'jotai'
import { walletAtom } from '@/atoms/walletAtom'
import { validateShieldAmount, handleAmountInputChange } from '@/services/validation'

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
      reset()
    }
  }, [open, reset])

  // Handle Escape key to close modal
  useEffect(() => {
    if (!open) return

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isConfirming) {
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open, onClose, isConfirming])

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
    const result = await shield(amount)

    if (result) {
      // Close modal after successful shield
      setTimeout(() => {
        onClose()
      }, 1000)
    } else {
      setIsConfirming(false)
    }
  }

  const handleMaxClick = () => {
    setAmount(transparentBalance)
  }

  const isDisabled = shieldingState.isShielding || isConfirming || !isAmountValid

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={!isConfirming ? onClose : undefined}
        aria-hidden="true"
      />

      {/* Modal Content */}
      <div className="relative z-50 w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-lg">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Shield USDC</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isConfirming}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Amount Input */}
          <div className="space-y-2">
            <label htmlFor="amount" className="text-sm font-medium">
              Amount (USDC)
            </label>
            <div className="flex items-center gap-2">
              <input
                id="amount"
                type="text"
                value={amount}
                onChange={(e) => handleAmountInputChange(e, setAmount, 6)}
                disabled={shieldingState.isShielding || isConfirming}
                placeholder="0.00"
                inputMode="decimal"
                className={`flex-1 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 transition-colors disabled:opacity-50 ${
                  amountError && amount.trim() !== ''
                    ? 'border-destructive focus:ring-destructive/20 focus:border-destructive'
                    : 'border-border focus:ring-ring'
                }`}
              />
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
          {amount && isAmountValid && (
            <div className="rounded-lg border border-border bg-muted/40 p-4">
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

          {/* Status Messages */}
          {shieldingState.phase && (
            <div className="rounded-lg border border-border bg-muted/40 p-3">
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

          {shieldingState.error && (
            <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-3">
              <p className="text-sm text-red-500">{shieldingState.error}</p>
            </div>
          )}

          {/* Footer Actions */}
          <div className="mt-6 flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={isConfirming}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={isDisabled}
            >
              {shieldingState.isShielding ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {shieldingState.phase === 'building' && 'Building...'}
                  {shieldingState.phase === 'signing' && 'Signing...'}
                  {shieldingState.phase === 'submitting' && 'Submitting...'}
                  {!shieldingState.phase && 'Processing...'}
                </>
              ) : (
                'Shield'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

