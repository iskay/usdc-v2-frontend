import { XCircle } from 'lucide-react'
import { Button } from '@/components/common/Button'

export interface ShieldingErrorStateProps {
  error: string
  onRetry: () => void
  onClose: () => void
}

export function ShieldingErrorState({
  error,
  onRetry,
  onClose,
}: ShieldingErrorStateProps) {
  return (
    <div className="space-y-4">
      {/* Error X Icon */}
      <div className="flex justify-center animate-in zoom-in-95 duration-500">
        <XCircle className="h-16 w-16 text-error" />
      </div>
      
      {/* Error Message */}
      <div className="rounded-lg border border-error/30 bg-error/10 p-4 animate-in fade-in slide-in-from-top-2 duration-300">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-error text-center">{error}</p>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="primary"
              onClick={onRetry}
              className="flex-1"
            >
              Try Again
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              className="flex-1"
            >
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

