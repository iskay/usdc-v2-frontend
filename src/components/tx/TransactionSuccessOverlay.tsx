/**
 * Full-page success overlay component for transaction completion.
 * Shows success message, transaction hash, explorer link, and countdown timer.
 */

import { useEffect, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { ExplorerLink } from '@/components/common/ExplorerLink'
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
  const [isFadingOut, setIsFadingOut] = useState(false)

  useEffect(() => {
    if (countdown <= 0) {
      // Start fade-out animation before navigation
      setIsFadingOut(true)
      // Wait for fade-out to complete (500ms) before navigating
      const navigateTimer = setTimeout(() => {
        onNavigate()
      }, 500)
      return () => clearTimeout(navigateTimer)
    }

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          // Start fade-out animation before navigation
          setIsFadingOut(true)
          // Wait for fade-out to complete (500ms) before navigating
          setTimeout(() => {
            onNavigate()
          }, 500)
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
        "absolute inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm animate-in fade-in duration-300",
        isFadingOut && "animate-out fade-out duration-500",
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

