import { Loader2 } from 'lucide-react'

export interface FeeInfo {
  feeAmount: string
  feeToken: string
  finalAmount: string
}

export interface ShieldingTransactionDetailsProps {
  amount: string
  feeInfo?: FeeInfo
  isEstimatingFee: boolean
}

export function ShieldingTransactionDetails({
  amount,
  feeInfo,
  isEstimatingFee,
}: ShieldingTransactionDetailsProps) {
  return (
    <div className="rounded-lg border bg-muted/40 p-4 transition-all border-border">
      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">From</span>
          <span className="font-medium">Transparent</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">To</span>
          <span className="font-medium">Shielded</span>
        </div>
        <div className="flex items-center justify-between border-t border-border pt-2">
          <span className="text-muted-foreground">Amount</span>
          <span className="font-semibold">{amount} USDC</span>
        </div>
        {/* Estimated Fee */}
        {isEstimatingFee ? (
          <div className="flex items-center justify-between border-t border-border pt-2">
            <span className="text-muted-foreground">Fee</span>
            <div className="flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span className="text-xs text-muted-foreground">Estimating...</span>
            </div>
          </div>
        ) : feeInfo ? (
          <>
            <div className="flex items-center justify-between border-t border-border pt-2">
              <span className="text-muted-foreground">Fee</span>
              <span className="font-medium">
                {feeInfo.feeAmount} {feeInfo.feeToken}
              </span>
            </div>
            {/* Final Amount (after fees) */}
            <div className="flex items-center justify-between border-t border-border pt-2">
              <span className="text-muted-foreground">Amount Shielded</span>
              <span className="font-semibold text-success">{feeInfo.finalAmount} USDC</span>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}

