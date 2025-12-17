import { Loader2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { handleAmountInputChange } from '@/services/validation'
import { cn } from '@/lib/utils'

export interface ShieldingAmountInputProps {
  amount: string
  onAmountChange: (amount: string) => void
  balance: string
  error?: string
  isEstimatingFee: boolean
  disabled?: boolean
  onMaxClick: () => void
}

export function ShieldingAmountInput({
  amount,
  onAmountChange,
  balance,
  error,
  isEstimatingFee,
  disabled,
  onMaxClick,
}: ShieldingAmountInputProps) {
  const showValidationError = error && amount.trim() !== ''

  return (
    <div className="space-y-2">
      <label htmlFor="amount" className="text-sm font-medium">
        Amount (USDC)
      </label>
      <div className="relative flex items-center gap-2">
        <input
          id="amount"
          type="text"
          value={amount}
          onChange={(e) => handleAmountInputChange(e, onAmountChange, 6)}
          disabled={disabled}
          placeholder="0.00"
          inputMode="decimal"
          className={cn(
            "flex-1 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 transition-colors disabled:opacity-50",
            isEstimatingFee && "pr-8",
            showValidationError
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
          onClick={onMaxClick}
          disabled={disabled}
          className="text-xs"
        >
          MAX
        </Button>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Available: {balance} USDC</span>
        </div>
        {showValidationError && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span className="flex-1">{error}</span>
          </div>
        )}
      </div>
    </div>
  )
}

