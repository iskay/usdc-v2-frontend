import { X } from 'lucide-react'
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
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Content */}
      <div className="relative z-50 w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-lg">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Delete Transaction</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Warning Message */}
        <div className="mb-6 space-y-2">
          <p className="text-sm text-foreground">
            Are you sure you want to delete this {transactionType === 'deposit' ? 'deposit' : 'payment'} transaction from your history?
          </p>
          <p className="text-sm font-medium text-destructive">
            This action cannot be undone.
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-3 justify-end">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleConfirm} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
            Delete
          </Button>
        </div>
      </div>
    </div>
  )
}

