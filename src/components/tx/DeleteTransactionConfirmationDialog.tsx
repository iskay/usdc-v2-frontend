import { X, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/common/Button'

interface DeleteTransactionConfirmationDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  transactionType?: 'deposit' | 'send'
}

export function DeleteTransactionConfirmationDialog({
  open,
  onClose,
  onConfirm,
  transactionType,
}: DeleteTransactionConfirmationDialogProps) {
  if (!open) return null

  const handleConfirm = () => {
    onConfirm()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Content */}
      <div className="relative z-50 w-full max-w-md rounded-xl border border-red-200/50 dark:border-red-800/50 bg-background shadow-2xl animate-in fade-in-0 zoom-in-95 duration-200">
        {/* Header with warning accent */}
        <div className="rounded-t-xl border-b border-red-200/50 dark:border-red-800/50 bg-red-50/50 dark:bg-red-950/20 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
                <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <h2 className="text-lg font-semibold text-foreground">Delete Transaction</h2>
            </div>
          <button
            type="button"
            onClick={onClose}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Close modal"
          >
              <X className="h-4 w-4" />
          </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
        {/* Warning Message */}
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-foreground">
              Are you sure you want to delete this{' '}
              <span className="font-medium">
                {transactionType === 'deposit' ? 'deposit' : 'payment'}
              </span>{' '}
              transaction from your history?
          </p>
            <div className="flex items-start gap-2 rounded-lg border border-red-200/50 dark:border-red-800/50 bg-red-50/30 dark:bg-red-950/10 p-3">
              <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm font-medium text-red-700 dark:text-red-300">
                This action cannot be undone. The transaction will be permanently removed from your local history.
          </p>
            </div>
        </div>

        {/* Actions */}
          <div className="flex gap-3 justify-end pt-2">
            <Button 
              variant="ghost" 
              onClick={onClose}
              className="min-w-[80px]"
            >
            Cancel
          </Button>
            <Button 
              onClick={handleConfirm} 
              className="min-w-[80px] bg-red-600 hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700 text-white border-0 focus:ring-red-500/50"
            >
            Delete
          </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

