/**
 * Unified transaction display component that replaces form content during transactions.
 * Handles progress (building/signing/submitting) and success states.
 * Returns null when idle to allow form to render normally.
 */

import { useEffect } from 'react'
import { useAtomValue } from 'jotai'
import { Lock, CheckCircle2 } from 'lucide-react'
import { ExplorerLink } from '@/components/common/ExplorerLink'
import { ProgressStepper, type TransactionPhase } from './ProgressStepper'
import { formatTxHash } from '@/utils/toastHelpers'
import { cn } from '@/lib/utils'
import { txUiAtom } from '@/atoms/txUiAtom'

export interface TransactionDisplayProps {
  phase: TransactionPhase
  showSuccessState: boolean
  txHash: string | null
  explorerUrl?: string
  onNavigate: () => void
  countdownSeconds?: number
  className?: string
}

export function TransactionDisplay({
  phase,
  showSuccessState,
  txHash,
  explorerUrl,
  onNavigate,
  countdownSeconds = 3,
  className,
}: TransactionDisplayProps) {
  const txUiState = useAtomValue(txUiAtom)
  const successTimestamp = txUiState.successTimestamp
  
  // Check if this is a MASP-related transaction (Shield or Send with IBC unshielding)
  const isMaspTransaction = txUiState.transactionType === 'shield' || txUiState.transactionType === 'send'

  // Calculate countdown from timestamp
  const countdown = successTimestamp
    ? Math.max(0, countdownSeconds - Math.floor((Date.now() - successTimestamp) / 1000))
    : countdownSeconds

  // Handle countdown timer for success state
  useEffect(() => {
    if (!showSuccessState || !txHash || !successTimestamp) {
      return
    }

    // Check if countdown has reached 0
    const remainingSeconds = Math.max(0, countdownSeconds - Math.floor((Date.now() - successTimestamp) / 1000))
    
    if (remainingSeconds <= 0) {
      // Navigate immediately when countdown reaches 0
      onNavigate()
      return
    }

    // Update countdown every second
    const timer = setInterval(() => {
      const currentRemaining = Math.max(0, countdownSeconds - Math.floor((Date.now() - successTimestamp) / 1000))
      
      if (currentRemaining <= 0) {
        clearInterval(timer)
        // Navigate immediately when countdown reaches 0
        onNavigate()
      }
    }, 1000)

    return () => clearInterval(timer)
  }, [showSuccessState, txHash, successTimestamp, countdownSeconds, onNavigate])

  // Return null when idle (no transaction active)
  if (!phase && !showSuccessState) {
    return null
  }

  // Show success state
  if (showSuccessState && txHash) {
    return (
      <div
        className={cn(
          "flex items-center justify-center min-h-[400px] w-full animate-in fade-in duration-300",
          className
        )}
      >
        <div className="text-center space-y-6 px-6 max-w-md">
          <div className="animate-in zoom-in-95 duration-500">
            <CheckCircle2 className="h-16 w-16 text-success mx-auto" />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold">Transaction Submitted!</h2>
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-center gap-2">
                <code className="text-sm font-mono text-muted-foreground bg-muted px-3 py-1.5 rounded">
                  {formatTxHash(txHash)}
                </code>
              </div>
              {explorerUrl && (
                <ExplorerLink
                  url={explorerUrl}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-secondary text-secondary-foreground hover:bg-secondary/80 px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary/40"
                >
                  View on Explorer
                </ExplorerLink>
              )}
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Returning to dashboard in {countdown}...
          </p>
        </div>
      </div>
    )
  }

  // Show progress state (building/signing/submitting)
  if (phase) {
    return (
      <div
        className={cn(
          "flex items-center justify-center min-h-[400px] w-full animate-in fade-in duration-300",
          className
        )}
      >
        <div className="text-center space-y-4 w-full max-w-md px-4">
          <Lock className="h-8 w-8 text-muted-foreground mx-auto animate-pulse" />
          <p className="text-sm text-muted-foreground">Transaction in progress...</p>
          <div className="flex justify-center">
            <ProgressStepper currentPhase={phase} isMaspTransaction={isMaspTransaction} />
          </div>
        </div>
      </div>
    )
  }

  // Fallback (should not reach here)
  return null
}
