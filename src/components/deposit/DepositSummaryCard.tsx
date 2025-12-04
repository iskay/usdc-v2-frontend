import { ArrowRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { cn } from '@/lib/utils'

interface DepositSummaryCardProps {
  amount: string
  chainName?: string
  isValid: boolean
  validationError: string | null
  onContinue: () => void
  isSubmitting: boolean
  currentPhase: 'building' | 'signing' | 'submitting' | null
}

export function DepositSummaryCard({
  amount,
  chainName,
  isValid,
  validationError,
  onContinue,
  isSubmitting,
  currentPhase,
}: DepositSummaryCardProps) {
  const displayAmount = amount.trim() !== ''
    ? chainName
      ? `${amount} USDC from ${chainName}`
      : `${amount} USDC`
    : '0 USDC'

  return (
    <div className="rounded-full border border-slate-200/50 bg-slate-50/50 dark:bg-slate-950/20 dark:border-slate-800/50 p-6 mx-12 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <ArrowRight className="h-4 w-4 text-slate-600 dark:text-slate-400" />
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Deposit now
            </span>
          </div>
          {validationError && (
            <p className="text-xs text-orange-600 dark:text-orange-400 ml-6">
              {validationError}
            </p>
          )}
        </div>
        <div className="flex items-center justify-between sm:justify-end gap-4">
          <span className="text-sm font-medium text-muted-foreground">
            {displayAmount}
          </span>
          <Button
            type="button"
            onClick={onContinue}
            disabled={!isValid || isSubmitting}
            className={cn(
              'bg-blue-600 hover:bg-blue-700 text-white border-blue-600 rounded-full',
              (!isValid || isSubmitting) && 'opacity-50 cursor-not-allowed'
            )}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>
                  {currentPhase === 'building' && 'Building...'}
                  {currentPhase === 'signing' && 'Signing...'}
                  {currentPhase === 'submitting' && 'Submitting...'}
                  {!currentPhase && 'Processing...'}
                </span>
              </>
            ) : (
              <>
                Continue <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

