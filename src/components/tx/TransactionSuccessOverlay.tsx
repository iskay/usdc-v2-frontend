/**
 * Full-page success overlay component for transaction completion.
 * Shows success message, transaction hash, explorer link, and countdown timer.
 */

import { useEffect, useState } from 'react'
import { CheckCircle2, ExternalLink } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { formatTxHash } from '@/utils/toastHelpers'
import { cn } from '@/lib/utils'

export interface TransactionSuccessOverlayProps {
  txHash: string
  explorerUrl?: string
  onNavigate: () => void
  countdownSeconds?: number
  className?: string
}

export function TransactionSuccessOverlay({
  txHash,
  explorerUrl,
  onNavigate,
  countdownSeconds = 3,
  className,
}: TransactionSuccessOverlayProps) {
  const [countdown, setCountdown] = useState(countdownSeconds)

  useEffect(() => {
    if (countdown <= 0) {
      onNavigate()
      return
    }

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          onNavigate()
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [countdown, onNavigate])

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm animate-in fade-in duration-300",
        className
      )}
    >
      <div className="text-center space-y-6 px-6 max-w-md">
        <div className="animate-in zoom-in-95 duration-500">
          <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto" />
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
              <Button
                type="button"
                variant="secondary"
                onClick={() => window.open(explorerUrl, '_blank', 'noopener,noreferrer')}
                className="gap-2"
              >
                <ExternalLink className="h-4 w-4" />
                View on Explorer
              </Button>
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

