import { CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { ExplorerLink } from '@/components/common/ExplorerLink'
import { formatTxHash } from '@/utils/toastHelpers'

export interface ShieldingSuccessStateProps {
  txHash: string
  explorerUrl?: string
  onNewTransaction: () => void
  onClose: () => void
}

export function ShieldingSuccessState({
  txHash,
  explorerUrl,
  onNewTransaction,
  onClose,
}: ShieldingSuccessStateProps) {
  return (
    <div className="space-y-4">
      {/* Success Checkmark */}
      <div className="flex justify-center animate-in zoom-in-95 duration-500">
        <CheckCircle2 className="h-16 w-16 text-success" />
      </div>
      
      {/* Success Message */}
      <div className="rounded-lg border border-success/30 bg-success/10 p-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
        <div className="flex flex-col gap-4">
          <p className="text-sm font-medium text-success text-center">
            Transaction submitted successfully!
          </p>
          <div className="flex items-center justify-center gap-2">
            <code className="text-xs font-mono text-success">
              {formatTxHash(txHash)}
            </code>
            {explorerUrl && (
              <ExplorerLink
                url={explorerUrl}
                size="sm"
                className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-2 py-1 h-6 text-xs font-medium transition-colors bg-transparent text-foreground hover:bg-muted"
              >
                View on Explorer
              </ExplorerLink>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="primary"
              onClick={onNewTransaction}
              className="flex-1"
            >
              New Transaction
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

