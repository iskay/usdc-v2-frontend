import { useCallback } from 'react'
import { toast } from 'sonner'
import { DEFAULT_TOAST_DURATION_MS } from '@/config/constants'

type ToastLevel = 'success' | 'error' | 'info'

interface ToastArgs {
  title: string
  description?: string
  level?: ToastLevel
}

export function useToast() {
  const notify = useCallback(({ title, description, level = 'info' }: ToastArgs) => {
    const options = { description, duration: DEFAULT_TOAST_DURATION_MS }
    switch (level) {
      case 'success':
        toast.success(title, options)
        break
      case 'error':
        toast.error(title, options)
        break
      default:
        toast(title, options)
    }
  }, [])

  // TODO: Correlate toast ids with tx lifecycle once backend integration lands.

  return { notify }
}
