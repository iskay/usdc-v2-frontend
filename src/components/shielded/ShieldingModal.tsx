/**
 * Shielding modal component for initiating shielding transactions.
 */

import { useState, useEffect, useMemo, type FormEvent } from 'react'
import { Button } from '@/components/common/Button'
import { useShielding } from '@/hooks/useShielding'
import { useBalance } from '@/hooks/useBalance'
import { useShieldingFeeEstimate } from '@/hooks/useShieldingFeeEstimate'
import { useModal } from '@/hooks/useModal'
import { useAtomValue } from 'jotai'
import { walletAtom } from '@/atoms/walletAtom'
import { txUiAtom, isAnyTransactionActiveAtom } from '@/atoms/txUiAtom'
import { validateShieldAmount } from '@/services/validation'
import { getTransactionPhaseAriaLabel } from '@/utils/transactionPhaseUtils'
import type { TransactionPhase } from '@/utils/transactionPhaseUtils'
import { cn } from '@/lib/utils'
import { ShieldingModalHeader, type ModalState } from './ShieldingModalHeader'
import { ShieldingAmountInput } from './ShieldingAmountInput'
import { ShieldingTransactionDetails } from './ShieldingTransactionDetails'
import { ShieldingProgressSection } from './ShieldingProgressSection'
import { ShieldingSuccessState } from './ShieldingSuccessState'
import { ShieldingErrorState } from './ShieldingErrorState'

export interface ShieldingModalProps {
  open: boolean
  onClose: () => void
}

export function ShieldingModal({ open, onClose }: ShieldingModalProps) {
  const { state: balanceState } = useBalance()
  const walletState = useAtomValue(walletAtom)
  const { state: shieldingState, shield, reset } = useShielding()
  const txUiState = useAtomValue(txUiAtom)
  const isAnyTxActive = useAtomValue(isAnyTransactionActiveAtom)
  const [amount, setAmount] = useState('')
  
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

  // Use modal hook for escape key and body scroll handling
  useModal(open, onClose, {
    preventCloseWhen: () => modalState === 'submitting',
  })

  // Reset form when modal closes (only if transaction is not active)
  useEffect(() => {
    if (!open && !isAnyTxActive) {
      setAmount('')
      reset()
    }
  }, [open, reset, isAnyTxActive])

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

    await shield(amount)
    // txHash and explorerUrl are now managed in global state by useShielding hook
    // Don't auto-close - let user close manually after reviewing success state
  }

  const handleRetry = () => {
    setAmount('')
    reset()
  }

  const handleNewTransaction = () => {
    setAmount('')
    reset()
  }

  const handleMaxClick = () => {
    setAmount(transparentBalance)
  }

  // Determine which parts of the form should be visible
  const showFormInputs = modalState === 'idle' || modalState === 'validating'
  const showTransactionDetails = showFormInputs && amount && (isAmountValid || amount.length > 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className={cn(
          "absolute inset-0 backdrop-blur-sm transition-all",
          modalState === 'submitting' ? "bg-overlay/90 backdrop-blur-md" : "bg-overlay backdrop-blur-sm"
        )}
        onClick={modalState !== 'submitting' ? onClose : undefined}
        aria-hidden="true"
      />

      {/* Modal Content */}
      <div className={cn(
        "relative z-50 w-full max-w-md rounded-lg border bg-background p-6 shadow-lg transition-all",
        modalState === 'submitting' && "border-primary/50"
      )}>
        <ShieldingModalHeader
          title="Shield USDC"
          modalState={modalState}
          onClose={onClose}
        />

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Amount Input - Only show during idle/validating states */}
          {showFormInputs && (
            <ShieldingAmountInput
              amount={amount}
              onAmountChange={setAmount}
              balance={transparentBalance}
              error={amountError ?? undefined}
              isEstimatingFee={isEstimatingFee}
              disabled={modalState !== 'idle' && modalState !== 'validating'}
              onMaxClick={handleMaxClick}
            />
          )}

          {/* Transaction Details - Only show during idle/validating states */}
          {showTransactionDetails && (
            <ShieldingTransactionDetails
              amount={amount}
              feeInfo={feeInfo ?? undefined}
              isEstimatingFee={isEstimatingFee}
            />
          )}

          {/* Progress Section - Show during submitting state and while waiting for success state */}
          {(modalState === 'submitting' || (txHash && !txUiState.showSuccessState)) && (
            <ShieldingProgressSection 
              currentPhase={
                // If phase is null but we have txHash, show 'submitting' to display all completed steps
                (txUiState.phase as TransactionPhase) ?? 'submitting'
              } 
            />
          )}

          {/* Enhanced Success State */}
          {modalState === 'success' && txHash && (
            <ShieldingSuccessState
              txHash={txHash}
              explorerUrl={explorerUrl}
              onNewTransaction={handleNewTransaction}
              onClose={onClose}
            />
          )}

          {/* Error State */}
          {modalState === 'error' && shieldingState.error && (
            <ShieldingErrorState
              error={shieldingState.error}
              onRetry={handleRetry}
              onClose={onClose}
            />
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
              {getTransactionPhaseAriaLabel(txUiState.phase as TransactionPhase)}
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
