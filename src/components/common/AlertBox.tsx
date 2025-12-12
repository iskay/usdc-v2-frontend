import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type AlertTone = 'info' | 'warning' | 'error'

interface AlertBoxProps {
  title?: string
  tone?: AlertTone
  children?: ReactNode
}

const toneStyles: Record<AlertTone, string> = {
  info: 'border-info/30 bg-info/10 text-info-foreground',
  warning: 'border-warning/30 bg-warning/10 text-warning-foreground',
  error: 'border-error/30 bg-error/10 text-error-foreground',
}

export function AlertBox({ title, tone = 'info', children }: AlertBoxProps) {
  return (
    <div className={cn('rounded-lg border px-4 py-3 text-sm shadow-sm', toneStyles[tone])}>
      {title ? <p className="mb-1 font-semibold">{title}</p> : null}
      {children ? <div className="space-y-1 text-sm leading-relaxed">{children}</div> : null}
    </div>
  )
}
