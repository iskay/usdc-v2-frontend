import { Loader2, AlertCircle, CheckCircle2, Info } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { CopyButton } from '@/components/common/CopyButton'
import { Tooltip } from '@/components/common/Tooltip'
import { truncateAddress } from '@/utils/addressUtils'
import { loadNobleFallbackAddress } from '@/services/storage/nobleFallbackStorage'
import type { DepositFallbackSelection } from '@/atoms/appAtom'
import type { DerivationState } from '@/hooks/useNobleFallbackDerivation'
import { NobleRegistrationStatus } from './NobleRegistrationStatus'

interface RegistrationStatus {
  isLoading: boolean
  isRegistered: boolean | null
  forwardingAddress: string | null
  error: string | null
}

interface NobleFallbackAddressSectionProps {
  showAdvanced: boolean
  fallbackSelection: DepositFallbackSelection
  useCustomOverride: boolean
  onCustomOverrideChange: (checked: boolean) => void
  derivationState: DerivationState
  onDerive: () => Promise<boolean>
  registrationStatus: RegistrationStatus
  isAnyTxActive: boolean
  hasAddressError: boolean
  recipientAddress: string
  metaMaskConnected: boolean
  metaMaskAccount: string | undefined
}

export function NobleFallbackAddressSection({
  showAdvanced,
  fallbackSelection,
  useCustomOverride,
  onCustomOverrideChange,
  derivationState,
  onDerive,
  registrationStatus,
  isAnyTxActive,
  hasAddressError,
  recipientAddress,
  metaMaskConnected,
  metaMaskAccount,
}: NobleFallbackAddressSectionProps) {
  if (!showAdvanced) {
    return null
  }

  return (
    <div className="mt-12 rounded-none border-t border-muted-foreground/20 p-3">
      <div className="space-y-2">
        <p className="text-sm font-semibold">Advanced Noble Forwarding Options</p>
        <div className="flex gap-1">
          <AlertCircle className="h-4 w-4 text-warning cursor-help" />
          <p className="text-xs text-warning/90">
            Most users don't need to adjust these settings!
          </p>
        </div>
        <div className="mt-4 space-y-2">
          <div className="mt-6 flex items-center gap-1.5">
            <p className="text-xs font-semibold text-foreground">Fallback address</p>
            <Tooltip content="If automatic IBC forwarding from Noble to Namada fails, your funds are refunded to this Noble address.">
              <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
            </Tooltip>
          </div>
          <p className="text-xs text-muted-foreground">
            Unless changed, your fallback address is derived from your MetaMask account when submitting the first deposit. You can also test derivation ahead of time or override with a custom address.
          </p>

          {/* Derivation status messages */}
          {derivationState.stage === 'signing' && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Requesting signature...</span>
            </div>
          )}
          {derivationState.stage === 'extracting' && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Extracting public key...</span>
            </div>
          )}
          {derivationState.stage === 'deriving' && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Deriving Noble address...</span>
            </div>
          )}
          {derivationState.stage === 'success' && (
            <div className="flex items-center gap-2 text-xs text-success mt-2">
              <CheckCircle2 className="h-3 w-3" />
              <span>Address derived successfully</span>
            </div>
          )}
          {derivationState.stage === 'error' && derivationState.error && (
            <div className="flex flex-col gap-2 mt-2">
              <div className="flex items-start gap-2 text-xs text-destructive">
                <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
                <span className="flex-1">{derivationState.error}</span>
              </div>
              {metaMaskConnected && metaMaskAccount && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={onDerive}
                  disabled={derivationState.isLoading || isAnyTxActive}
                  className="text-xs h-7 px-2 w-fit"
                >
                  Try again
                </Button>
              )}
            </div>
          )}

          {/* Derive button - available as an option to derive ahead of time */}
          {metaMaskConnected &&
            metaMaskAccount &&
            !useCustomOverride &&
            derivationState.stage === 'idle' && (
              <Button
                type="button"
                variant="secondary"
                onClick={onDerive}
                disabled={derivationState.isLoading || isAnyTxActive}
                className="text-xs h-7 px-3 mt-2"
              >
                {derivationState.isLoading ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Deriving...
                  </>
                ) : (
                  'Test Derivation now'
                )}
              </Button>
            )}

          {/* Checkbox for custom address override */}
          <div className="flex items-center gap-2 mt-4">
            <input
              type="checkbox"
              id="fallback-custom-override"
              checked={useCustomOverride}
              onChange={(e) => onCustomOverrideChange(e.target.checked)}
              disabled={!loadNobleFallbackAddress() || isAnyTxActive}
              className="w-3.5 h-3.5 rounded border-input text-primary focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <label
              htmlFor="fallback-custom-override"
              className={`text-xs cursor-pointer ${!loadNobleFallbackAddress() || isAnyTxActive ? 'text-muted-foreground' : ''}`}
            >
              Use custom address from Settings instead
              {!loadNobleFallbackAddress() && ' (not set)'}
            </label>
          </div>

          {/* Display selected address */}
          {fallbackSelection.address && (
            <div className="flex items-center gap-2 text-xs text-foreground/90 mt-3">
              <span>Currently using</span>
              <div className="flex items-center gap-1.5">
                <span className="font-mono">
                  {truncateAddress(fallbackSelection.address, 8, 6)}
                </span>
                <CopyButton
                  text={fallbackSelection.address}
                  label="Fallback address"
                  size="sm"
                />
              </div>
              <span className="text-muted-foreground">
                ({fallbackSelection.source === 'custom' ? 'custom' : 'derived'})
              </span>
            </div>
          )}

          <div className="mt-6 flex items-center gap-1.5">
            <p className="text-xs font-semibold text-foreground">Forwarding address</p>
            <Tooltip content="A deterministic address derived from the tuple of channel/recipient/fallback. Any funds sent here will be automatically forwarded to the destination after registration.">
              <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
            </Tooltip>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Registration will be completed automatically during deposit, and a 0.02 USDC registration fee will be subtracted from the amount transferred. This only applies once per forwarding address.
          </p>

          {/* Noble forwarding registration status */}
          {!hasAddressError && recipientAddress.trim() !== '' && (
            <NobleRegistrationStatus status={registrationStatus} />
          )}
        </div>
      </div>
    </div>
  )
}

