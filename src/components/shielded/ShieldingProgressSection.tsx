import { Loader2 } from 'lucide-react'
import { ProgressStepper } from '@/components/tx/ProgressStepper'
import { getTransactionPhaseMessage } from '@/utils/transactionPhaseUtils'
import type { TransactionPhase } from '@/utils/transactionPhaseUtils'

export interface ShieldingProgressSectionProps {
  currentPhase: TransactionPhase
}

export function ShieldingProgressSection({ currentPhase }: ShieldingProgressSectionProps) {
  const phaseMessage = getTransactionPhaseMessage(currentPhase)

  return (
    <>
      {/* Progress Stepper */}
      <ProgressStepper currentPhase={currentPhase} isMaspTransaction={true} />

      {/* Status Message */}
      {currentPhase && (
        <div className="rounded-lg border border-border bg-muted/40 p-3 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{phaseMessage}</span>
          </div>
        </div>
      )}
    </>
  )
}

