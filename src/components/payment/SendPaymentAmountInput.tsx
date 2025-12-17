import { Loader2, AlertCircle } from 'lucide-react'
import { Tooltip } from '@/components/common/Tooltip'
import { handleAmountInputChange } from '@/services/validation'

interface SendPaymentAmountInputProps {
  amount: string
  onAmountChange: (amount: string) => void
  availableBalance: string
  isShieldedBalanceLoading: boolean
  hasBalanceError: boolean
  validationError: string | null
  feeInfo: {
    feeToken: 'USDC' | 'NAM'
    feeAmount: string
  } | null
}

export function SendPaymentAmountInput({
  amount,
  onAmountChange,
  availableBalance,
  isShieldedBalanceLoading,
  hasBalanceError,
  validationError,
  feeInfo,
}: SendPaymentAmountInputProps) {
  const handleUseMax = () => {
    if (availableBalance !== '--' && availableBalance !== '0.00') {
      const balanceNum = parseFloat(availableBalance)
      const feeNum = feeInfo && feeInfo.feeToken === 'USDC' ? parseFloat(feeInfo.feeAmount) : 0
      const maxAmount = Math.max(0, balanceNum - feeNum)
      // Format to 6 decimal places to match input handling
      onAmountChange(maxAmount.toFixed(6).replace(/\.?0+$/, ''))
    }
  }

  return (
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
            {isShieldedBalanceLoading && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Loading shielded balance" />
            )}
            {hasBalanceError && (
              <Tooltip content="Could not query shielded balances from chain" side="top">
                <AlertCircle className="h-3.5 w-3.5 text-error" aria-label="Shielded balance error" />
              </Tooltip>
            )}
          </div>
          <button
            type="button"
            onClick={handleUseMax}
            disabled={availableBalance === '--' || availableBalance === '0.00'}
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
          onChange={(e) => handleAmountInputChange(e, onAmountChange, 6)}
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
      {validationError && amount.trim() !== '' && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span className="flex-1">{validationError}</span>
        </div>
      )}
    </div>
  )
}

