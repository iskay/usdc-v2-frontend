/**
 * Reusable progress stepper component for transaction flows.
 * Shows Build → Sign → Submit phases with visual completion states.
 */

import { CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export type TransactionPhase = 'building' | 'signing' | 'submitting' | null

export interface ProgressStepperProps {
  currentPhase: TransactionPhase
  className?: string
}

export function ProgressStepper({ currentPhase, className }: ProgressStepperProps) {
  const phases: Array<'building' | 'signing' | 'submitting'> = ['building', 'signing', 'submitting']
  
  return (
    <div className={cn("flex items-center justify-between px-2 py-4", className)}>
      {phases.map((phase, idx) => {
        const isActive = currentPhase === phase
        const phaseIndex = currentPhase ? phases.indexOf(currentPhase) : -1
        const isComplete = phaseIndex > idx
        
        return (
          <div key={phase} className="flex items-center flex-1">
            <div className="flex flex-col items-center flex-1">
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium transition-all",
                isComplete && "bg-success text-foreground",
                isActive && "bg-primary text-primary-foreground ring-2 ring-primary ring-offset-3 ring-offset-background",
                !isActive && !isComplete && "bg-muted text-muted-foreground"
              )}>
                {isComplete ? <CheckCircle2 className="h-4 w-4" /> : idx + 1}
              </div>
              <span className={cn(
                "text-xs mt-3 text-center",
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
                isComplete ? "bg-success" : "bg-muted"
              )} />
            )}
          </div>
        )
      })}
    </div>
  )
}

