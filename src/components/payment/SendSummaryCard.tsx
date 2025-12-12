import { ArrowRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { cn } from '@/lib/utils'

interface SendSummaryCardProps {
  amount: string
  chainName?: string
  isValid: boolean
  validationError: string | null
  onContinue: () => void
  isSubmitting: boolean
  currentPhase: 'building' | 'signing' | 'submitting' | null
}

export function SendSummaryCard({
  amount,
  chainName,
  isValid,
  validationError,
  onContinue,
  isSubmitting,
  currentPhase,
}: SendSummaryCardProps) {
  const displayAmount = amount.trim() !== ''
    ? chainName
      ? `${amount} USDC to ${chainName}`
      : `${amount} USDC`
    : '0 USDC'

  return (
    <div className="card card-rounded-full card-xl mx-12">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold text-foreground">
              Send now
            </span>
          </div>
          {validationError && (
            <p className="text-xs text-warning ml-6">
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

