import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type AlertTone = 'info' | 'warning' | 'error'

interface AlertBoxProps {
  title?: string
  tone?: AlertTone
  children?: ReactNode
}

const toneStyles: Record<AlertTone, string> = {
  info: 'border-blue-400 bg-blue-50 text-blue-950 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-100',
  warning:
    'border-amber-400 bg-amber-50 text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100',
  error:
    'border-destructive bg-destructive/10 text-destructive dark:border-destructive/40 dark:bg-destructive/10 dark:text-destructive-foreground',
}

export function AlertBox({ title, tone = 'info', children }: AlertBoxProps) {
  return (
    <div className={cn('rounded-lg border px-4 py-3 text-sm shadow-sm', toneStyles[tone])}>
      {title ? <p className="mb-1 font-semibold">{title}</p> : null}
      {children ? <div className="space-y-1 text-sm leading-relaxed">{children}</div> : null}
    </div>
  )
}
