import { useAtom } from 'jotai'
import { useShieldedSync } from '@/hooks/useShieldedSync'
import { shieldedProgressAtom } from '@/atoms/shieldedAtom'
import { Button } from '@/components/common/Button'
import { CheckCircle2, XCircle, Loader2, Shield } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ShieldedSyncProgressProps {
  compact?: boolean
}

export function ShieldedSyncProgress({ compact = false }: ShieldedSyncProgressProps) {
  const { state, startSync, isReady } = useShieldedSync()
  const [progress] = useAtom(shieldedProgressAtom)

  const status = state.status ?? 'idle'
  const isActive = state.isSyncing || status === 'error' || status === 'complete'
  const progressPercentage = progress ?? 0

  // Show component when ready or active, or show a message when not ready
  if (!isReady && !isActive) {
    if (compact) {
      return null
    }
    return (
      <div className="card">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Shield className="h-5 w-5" />
          <span>Connect your Namada wallet to sync shielded balance</span>
        </div>
      </div>
    )
  }

  const getStatusIcon = () => {
    const iconSize = compact ? 'h-4 w-4' : 'h-5 w-5'
    switch (status) {
      case 'complete':
        return <CheckCircle2 className={cn(iconSize, 'text-success')} />
      case 'error':
        return <XCircle className={cn(iconSize, 'text-error')} />
      case 'syncing':
      case 'initializing':
      case 'loading-params':
      case 'finalizing':
        return <Loader2 className={cn(iconSize, 'animate-spin text-info')} />
      default:
        return <Shield className={cn(iconSize, 'text-muted-foreground')} />
    }
  }

  const getStatusText = () => {
    switch (status) {
      case 'complete':
        return 'Complete'
      case 'error':
        return 'Failed'
      case 'initializing':
        return 'Initializing'
      case 'loading-params':
        return 'Loading params'
      case 'syncing':
        return 'Syncing'
      case 'finalizing':
        return 'Finalizing'
      default:
        return 'Ready'
    }
  }

  const getStatusColor = () => {
    switch (status) {
      case 'complete':
        return 'text-success'
      case 'error':
        return 'text-error'
      case 'syncing':
      case 'initializing':
      case 'loading-params':
      case 'finalizing':
        return 'text-info'
      default:
        return 'text-muted-foreground'
    }
  }

  // Don't show anything when complete or idle in compact mode
  if (compact && (status === 'complete' || status === 'idle')) {
    return null
  }

  const content = (
    <div className={cn('flex items-center gap-2', compact && 'gap-1.5')}>
      {!compact && getStatusIcon()}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {!compact && (
            <span className={cn('text-sm', 'font-semibold', getStatusColor())}>
              {getStatusText()}
            </span>
          )}
          {status === 'syncing' && (
            <span className={cn('text-muted-foreground', compact ? 'text-xs' : 'text-xs')}>
              {progressPercentage}%
            </span>
          )}
        </div>

        {/* Progress bar */}
        {(status === 'syncing' || status === 'initializing' || status === 'loading-params' || status === 'finalizing') && (
          <div className={cn('mt-1.5 w-full overflow-hidden rounded-full bg-muted', compact ? 'h-1' : 'h-2')}>
            <div
              className="h-full bg-info transition-all duration-300 ease-out"
              style={{ width: `${progressPercentage}%` }}
              role="progressbar"
              aria-valuenow={progressPercentage}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
        )}

        {/* Error message - inline text instead of AlertBox */}
        {status === 'error' && state.lastError && (
          <p className={cn('text-muted-foreground', compact ? 'mt-1 text-xs' : 'mt-1.5 text-xs')}>
            {state.lastError}
          </p>
        )}
      </div>

      {/* Action buttons - only show in non-compact mode */}
      {!compact && (
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
      )}
    </div>
  )

  if (compact) {
    return content
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-4">
        {content}
      </div>
    </div>
  )
}

