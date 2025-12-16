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
  const textSizeClass = size === 'sm' ? 'text-xs' : size === 'md' ? 'text-sm' : size === 'lg' ? 'text-base' : 'text-sm'

  return (
    <div className={cn('space-y-2', className)}>
      <dt className={cn('text-muted-foreground', 'text-sm')}>{label}</dt>
      <dd>
        <div className="flex items-center justify-start gap-2">
          <span className={cn(textSizeClass, 'font-mono', valueClassName)}>{value}</span>
          <div className="gap-0 flex">
            <CopyButton
              text={value}
              label={label}
              size='md'
              onCopy={onCopy}
            />
            {explorerUrl && (
              <ExplorerLink
                url={explorerUrl}
                label={`Open ${label} in explorer`}
                size='md'
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
