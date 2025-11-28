import { useAtom } from 'jotai'
import { useShieldedSync } from '@/hooks/useShieldedSync'
import { shieldedProgressAtom } from '@/atoms/shieldedAtom'
import { AlertBox } from '@/components/common/AlertBox'
import { Button } from '@/components/common/Button'
import { CheckCircle2, XCircle, Loader2, Shield } from 'lucide-react'
import { cn } from '@/lib/utils'

export function ShieldedSyncProgress() {
  const { state, startSync, isReady } = useShieldedSync()
  const [progress] = useAtom(shieldedProgressAtom)

  const status = state.status ?? 'idle'
  const isActive = state.isSyncing || status === 'error' || status === 'complete'
  const progressPercentage = progress ?? 0

  // Show component when ready or active, or show a message when not ready
  if (!isReady && !isActive) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Shield className="h-5 w-5" />
          <span>Connect your Namada wallet to sync shielded balance</span>
        </div>
      </div>
    )
  }

  const getStatusIcon = () => {
    switch (status) {
      case 'complete':
        return <CheckCircle2 className="h-5 w-5 text-green-500" />
      case 'error':
        return <XCircle className="h-5 w-5 text-red-500" />
      case 'syncing':
      case 'initializing':
      case 'loading-params':
      case 'finalizing':
        return <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
      default:
        return <Shield className="h-5 w-5 text-muted-foreground" />
    }
  }

  const getStatusText = () => {
    switch (status) {
      case 'complete':
        return 'Sync complete'
      case 'error':
        return 'Sync failed'
      case 'initializing':
        return 'Initializing...'
      case 'loading-params':
        return 'Loading MASP parameters...'
      case 'syncing':
        return 'Syncing shielded notes...'
      case 'finalizing':
        return 'Finalizing...'
      default:
        return 'Ready to sync'
    }
  }

  const getStatusColor = () => {
    switch (status) {
      case 'complete':
        return 'text-green-500'
      case 'error':
        return 'text-red-500'
      case 'syncing':
      case 'initializing':
      case 'loading-params':
      case 'finalizing':
        return 'text-blue-500'
      default:
        return 'text-muted-foreground'
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-1 items-center gap-3">
          {getStatusIcon()}
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className={cn('text-sm font-semibold', getStatusColor())}>{getStatusText()}</span>
              {status === 'syncing' && (
                <span className="text-xs text-muted-foreground">{progressPercentage}%</span>
              )}
            </div>

            {/* Progress bar */}
            {(status === 'syncing' || status === 'initializing' || status === 'loading-params' || status === 'finalizing') && (
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-blue-500 transition-all duration-300 ease-out"
                  style={{ width: `${progressPercentage}%` }}
                  role="progressbar"
                  aria-valuenow={progressPercentage}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>
            )}

            {/* Error message */}
            {status === 'error' && state.lastError && (
              <div className="mt-2">
                <AlertBox tone="error" title="Sync Error">
                  {state.lastError}
                </AlertBox>
              </div>
            )}

            {/* Success message */}
            {status === 'complete' && (
              <p className="mt-1 text-xs text-muted-foreground">
                Shielded balance is up to date
                {state.lastSyncedHeight && ` (synced at height ${state.lastSyncedHeight})`}
              </p>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {status === 'error' ? (
            <Button variant="primary" className="h-8 px-3 text-xs" onClick={startSync} disabled={!isReady}>
              Retry
            </Button>
          ) : isReady && !state.isSyncing ? (
            <Button variant="primary" className="h-8 px-3 text-xs" onClick={startSync}>
              Start Sync
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

