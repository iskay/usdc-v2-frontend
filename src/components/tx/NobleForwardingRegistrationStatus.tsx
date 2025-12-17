import { RegisterNobleForwardingButton } from '@/components/polling/RegisterNobleForwardingButton'

export interface NobleForwardingRegistrationStatusProps {
  reg: {
    alreadyRegistered?: boolean
    registrationTx?: { txHash?: string }
    balanceCheck?: {
      performed?: boolean
      sufficient?: boolean
      balanceUusdc?: string
      minRequiredUusdc?: string
    }
    errorMessage?: string
  }
  forwardingAddress?: string
  recipientAddress?: string
  channelId?: string
  fallback?: string
  txId: string
}

export function NobleForwardingRegistrationStatus({
  reg,
  forwardingAddress,
  recipientAddress,
  channelId,
  fallback,
  txId,
}: NobleForwardingRegistrationStatusProps) {
  let statusMessage
  if (reg.alreadyRegistered) {
    statusMessage = (
      <p className="mt-1 text-xs text-success">
        Already registered
      </p>
    )
  } else if (reg.registrationTx?.txHash) {
    statusMessage = (
      <p className="mt-1 text-xs text-success">
        Registered: {reg.registrationTx.txHash.slice(0, 16)}...
      </p>
    )
  } else if (reg.balanceCheck?.performed && !reg.balanceCheck.sufficient) {
    statusMessage = (
      <p className="mt-1 text-xs text-warning">
        Insufficient balance: {reg.balanceCheck.balanceUusdc || '0'} uusdc &lt; {reg.balanceCheck.minRequiredUusdc || '0'} uusdc required
      </p>
    )
  } else if (reg.errorMessage) {
    statusMessage = (
      <p className="mt-1 text-xs text-error">
        Error: {reg.errorMessage}
      </p>
    )
  } else {
    statusMessage = (
      <p className="mt-1 text-xs text-muted-foreground">
        Registration pending
      </p>
    )
  }

  const showButton = forwardingAddress && recipientAddress && !reg.registrationTx?.txHash && !reg.alreadyRegistered

  return (
    <div className="border border-border rounded-md bg-muted/50 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-foreground">Noble Forwarding Registration</h4>
          {statusMessage}
        </div>
        {showButton && (
          <RegisterNobleForwardingButton
            txId={txId}
            forwardingAddress={forwardingAddress!}
            recipientAddress={recipientAddress!}
            channelId={channelId}
            fallback={fallback}
            size="sm"
            variant="outline"
          />
        )}
      </div>

      {/* Balance Check Details */}
      {reg.balanceCheck?.performed && (
        <div className="mt-2 pt-2 border-t border-border text-xs text-muted-foreground">
          <p>Balance: {reg.balanceCheck.balanceUusdc || '0'} uusdc</p>
          <p>Required: {reg.balanceCheck.minRequiredUusdc || '0'} uusdc</p>
        </div>
      )}
    </div>
  )
}

