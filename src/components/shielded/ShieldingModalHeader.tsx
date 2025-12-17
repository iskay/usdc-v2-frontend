import { X, Lock } from 'lucide-react'

export type ModalState = 
  | 'idle'           // Form ready for input
  | 'validating'     // User typing, validation running
  | 'submitting'     // Transaction in progress (building/signing/submitting)
  | 'success'         // Transaction completed successfully
  | 'error'           // Transaction failed

export interface ShieldingModalHeaderProps {
  title: string
  modalState: ModalState
  onClose: () => void
}

export function ShieldingModalHeader({
  title,
  modalState,
  onClose,
}: ShieldingModalHeaderProps) {
  return (
    <div className="mb-6 flex items-center justify-between">
      <h2 className="text-xl font-semibold">{title}</h2>
      {modalState !== 'submitting' && (
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label="Close modal"
        >
          <X className="h-5 w-5" />
        </button>
      )}
      {modalState === 'submitting' && (
        <div className="rounded-md p-1 text-muted-foreground" aria-label="Modal locked during transaction">
          <Lock className="h-5 w-5" />
        </div>
      )}
    </div>
  )
}

