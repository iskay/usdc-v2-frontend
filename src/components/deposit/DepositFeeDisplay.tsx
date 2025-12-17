import { Loader2 } from 'lucide-react'

interface DepositFeeDisplayProps {
  feeInfo: {
    totalNative: string
    nativeSymbol: string
    totalUsd?: number
  } | null
  isEstimatingFee: boolean
  total: string
}

export function DepositFeeDisplay({ feeInfo, isEstimatingFee, total }: DepositFeeDisplayProps) {
  const estimatedFee = feeInfo
    ? feeInfo.totalUsd !== undefined
      ? `${feeInfo.totalNative} ${feeInfo.nativeSymbol} (~$${feeInfo.totalUsd.toFixed(4)})`
      : `${feeInfo.totalNative} ${feeInfo.nativeSymbol}`
    : '--'

  return (
    <div className="space-y-3 mx-auto my-8">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Network fee</span>
        {isEstimatingFee ? (
          <div className="flex items-center gap-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Estimating...</span>
          </div>
        ) : feeInfo ? (
          <span className="text-sm font-semibold">{estimatedFee}</span>
        ) : (
          <span className="text-sm text-muted-foreground">--</span>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-border pt-3 space-x-24">
        <span className="text-base font-semibold">Total amount deducted</span>
        <span className="text-xl font-bold">${total}</span>
      </div>
    </div>
  )
}

