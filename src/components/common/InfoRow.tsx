import { CopyButton } from './CopyButton'
import { ExplorerLink } from './ExplorerLink'
import { cn } from '@/lib/utils'

interface InfoRowProps {
  label: string
  value: string
  explorerUrl?: string
  onCopy?: () => void
  className?: string
  valueClassName?: string
  size?: 'sm' | 'md' | 'lg'
}

export function InfoRow({
  label,
  value,
  explorerUrl,
  onCopy,
  className,
  valueClassName,
  size = 'md',
}: InfoRowProps) {
  const textSizeClass = size === 'sm' ? 'text-xs' : 'text-sm'

  return (
    <div className={cn('space-y-1', className)}>
      <dt className={cn('text-muted-foreground', textSizeClass)}>{label}</dt>
      <dd>
        <div className="flex justify-between gap-2">
          <span className={cn('font-mono', textSizeClass, valueClassName)}>{value}</span>
          <div className="action-group">
            <CopyButton
              text={value}
              label={label}
              size={size}
              onCopy={onCopy}
            />
            {explorerUrl && (
              <ExplorerLink
                url={explorerUrl}
                label={`Open ${label} in explorer`}
                size={size}
                iconOnly
                className="explorer-link-inline"
              />
            )}
          </div>
        </div>
      </dd>
    </div>
  )
}
