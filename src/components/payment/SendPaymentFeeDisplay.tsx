import { Loader2 } from 'lucide-react'

interface SendPaymentFeeDisplayProps {
  feeInfo: {
    feeToken: 'USDC' | 'NAM'
    feeAmount: string
  } | null
  isEstimatingFee: boolean
  total: string
  amount: string
}

export function SendPaymentFeeDisplay({ feeInfo, isEstimatingFee, total, amount }: SendPaymentFeeDisplayProps) {
  const feeDisplay = feeInfo
    ? feeInfo.feeToken === 'USDC'
      ? `$${parseFloat(feeInfo.feeAmount).toFixed(2)}`
      : `${parseFloat(feeInfo.feeAmount).toFixed(6)} NAM`
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
          <span className="text-sm font-semibold">{feeDisplay}</span>
        ) : (
          <span className="text-sm text-muted-foreground">--</span>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-border pt-3 space-x-24">
        <span className="text-base font-semibold">Total amount deducted</span>
        <span className="text-xl font-bold">
          {feeInfo && feeInfo.feeToken === 'USDC' ? `$${total}` : `$${amount || '0.00'}`}
        </span>
      </div>
    </div>
  )
}

