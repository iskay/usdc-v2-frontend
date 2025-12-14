import { useCallback } from 'react'
import { toast } from 'sonner'
import { TOAST_DURATION } from '@/config/constants'
import type { ReactNode } from 'react'
import { getToastIcon } from '@/utils/toastHelpers'

export type ToastLevel = 'success' | 'error' | 'info' | 'warning' | 'loading'

export interface ToastActionButton {
  label: string
  onClick: () => void | Promise<void>
}

export interface ToastArgs {
  title: string
  description?: string
  level?: ToastLevel
  duration?: number
  action?: ToastActionButton
  icon?: ReactNode
  id?: string | number
}

export function useToast() {
  const notify = useCallback(
    ({
      title,
      description,
      level = 'info',
      duration,
      action,
      icon,
      id,
    }: ToastArgs) => {
      // Determine duration based on level if not provided
      const toastDuration =
        duration ??
        (level === 'error'
          ? TOAST_DURATION.LONG
          : level === 'info'
            ? TOAST_DURATION.SHORT
            : level === 'loading'
              ? TOAST_DURATION.PERSISTENT
              : TOAST_DURATION.DEFAULT)

      const options: Parameters<typeof toast>[1] = {
        description,
        duration: toastDuration === Infinity ? undefined : toastDuration,
        id,
      }

      // Add action button if provided
      if (action) {
        options.action = {
          label: action.label,
          onClick: action.onClick,
        }
      }

      // Add custom icon if provided, otherwise use default icon with theme colors
      if (icon) {
        options.icon = icon
      } else {
        // Automatically add icon with theme colors when no icon is provided
        options.icon = getToastIcon(level)
      }

      // Handle different toast levels
      switch (level) {
        case 'success':
          toast.success(title, options)
          break
        case 'error':
          toast.error(title, options)
          break
        case 'warning':
          toast.warning(title, options)
          break
        case 'loading':
          toast.loading(title, options)
          break
        default:
          toast(title, options)
      }
    },
    []
  )

  // Helper to update an existing toast (useful for transaction status updates)
  const updateToast = useCallback(
    (id: string | number, args: Omit<ToastArgs, 'id'>) => {
      notify({ ...args, id })
    },
    [notify]
  )

  // Helper to dismiss a toast
  const dismissToast = useCallback((id?: string | number) => {
    toast.dismiss(id)
  }, [])

  return { notify, updateToast, dismissToast }
}
