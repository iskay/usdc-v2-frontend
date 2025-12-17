import { Loader2, CheckCircle2, Info, AlertCircle } from 'lucide-react'
import { CopyButton } from '@/components/common/CopyButton'
import { truncateAddress } from '@/utils/addressUtils'

interface RegistrationStatus {
  isLoading: boolean
  isRegistered: boolean | null
  forwardingAddress: string | null
  error: string | null
}

interface NobleRegistrationStatusProps {
  status: RegistrationStatus
  showWhenAddressEmpty?: boolean
}

export function NobleRegistrationStatus({ status, showWhenAddressEmpty = false }: NobleRegistrationStatusProps) {
  // Don't show if address is empty and showWhenAddressEmpty is false
  if (!showWhenAddressEmpty && !status.forwardingAddress && !status.isLoading && !status.error) {
    return null
  }

  if (status.isLoading) {
    return (
      <div className="mt-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Checking registration status...</span>
        </div>
      </div>
    )
  }

  if (status.isRegistered === true) {
    return (
      <div className="mt-3">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-success" />
          <div className="flex-1 space-y-2">
            <div className="flex justify-between items-center">
              <p className="text-xs text-muted-foreground">Already registered</p>
              {status.forwardingAddress && (
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">
                    {truncateAddress(status.forwardingAddress, 8, 6)}
                  </span>
                  <CopyButton
                    text={status.forwardingAddress}
                    label="Forwarding address"
                    size="sm"
                    className="hover:bg-info/20"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (status.isRegistered === false) {
    return (
      <div className="mt-3">
        <div className="flex items-center gap-3">
          <Info className="h-4 w-4 shrink-0 mt-0.5 text-warning" />
          <div className="flex-1 space-y-2">
            <div className="flex justify-between items-center">
              <p className="text-xs text-muted-foreground">Registration required</p>
              {status.forwardingAddress && (
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">
                    {truncateAddress(status.forwardingAddress, 8, 6)}
                  </span>
                  <CopyButton
                    text={status.forwardingAddress}
                    label="Forwarding address"
                    size="sm"
                    className="hover:bg-warning/20"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (status.error) {
    const isDerivationError = status.error.includes('Fallback address not yet derived') ||
      status.error.includes('not yet derived')

    return (
      <div className="mt-3">
        <div className="flex items-center gap-3">
          {isDerivationError ? (
            <Info className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-error" />
          )}
          <div className="flex-1 space-y-1">
            <p className={`text-xs ${isDerivationError ? 'text-muted-foreground' : 'text-error'}`}>
              {isDerivationError
                ? 'Derive a fallback address first to view forwarding registration status. You can use the \'Test Derivation now\' button above.'
                : 'Unable to query Noble API'}
            </p>
          </div>
        </div>
      </div>
    )
  }

  return null
}

