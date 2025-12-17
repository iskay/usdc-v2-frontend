import { AlertCircle } from 'lucide-react'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { RecipientAddressInput } from '@/components/recipient/RecipientAddressInput'
import { truncateAddress } from '@/utils/addressUtils'
import { NobleFallbackAddressSection } from './NobleFallbackAddressSection'
import type { DepositFallbackSelection } from '@/atoms/appAtom'
import type { DerivationState } from '@/hooks/useNobleFallbackDerivation'
import type { RegistrationStatus } from '@/hooks/useNobleRegistrationStatus'

interface DepositRecipientSectionProps {
  recipientType: 'transparent' | 'custom'
  onRecipientTypeChange: (type: 'transparent' | 'custom') => void
  address: string
  onAddressChange: (address: string) => void
  recipientName: string | null
  onRecipientNameChange: (name: string | null) => void
  onNameValidationChange: (isValid: boolean, error: string | null) => void
  validationError: string | null
  showAdvanced: boolean
  onShowAdvancedChange: (show: boolean) => void
  fallbackSelection: DepositFallbackSelection
  useCustomOverride: boolean
  onCustomOverrideChange: (checked: boolean) => void
  derivationState: DerivationState
  onDerive: () => Promise<boolean>
  registrationStatus: RegistrationStatus
  isAnyTxActive: boolean
  namadaConnected: boolean
  namadaAccount: string | undefined
  metaMaskConnected: boolean
  metaMaskAccount: string | undefined
  onAutoFill?: () => void
}

export function DepositRecipientSection({
  recipientType,
  onRecipientTypeChange,
  address,
  onAddressChange,
  onRecipientNameChange,
  onNameValidationChange,
  validationError,
  showAdvanced,
  onShowAdvancedChange,
  fallbackSelection,
  useCustomOverride,
  onCustomOverrideChange,
  derivationState,
  onDerive,
  registrationStatus,
  isAnyTxActive,
  namadaConnected,
  namadaAccount,
  metaMaskConnected,
  metaMaskAccount,
  onAutoFill,
}: DepositRecipientSectionProps) {
  return (
    <div className="flex-1 card card-xl">
      <div className="flex items-baseline justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-1 rounded">
            Step 2
          </span>
          <label className="text-sm font-semibold">Deposit to</label>
        </div>
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={() => onShowAdvancedChange(!showAdvanced)}
            className="text-xs text-warning hover:text-warning/80 transition-colors"
          >
            Advanced
          </button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground mb-3">
        Namada address where your USDC will arrive
      </p>

      {/* Radio selector for recipient type */}
      <RadioGroup
        value={recipientType}
        onValueChange={(value) => onRecipientTypeChange(value as 'transparent' | 'custom')}
        className="flex flex-col gap-3 mb-3"
        disabled={isAnyTxActive}
      >
        <div className="flex items-center gap-2">
          <RadioGroupItem
            value="transparent"
            id="transparent"
            disabled={isAnyTxActive || !namadaConnected}
            className="mt-0.5"
          />
          <label
            htmlFor="transparent"
            className="flex-1 cursor-pointer"
          >
            <div className="flex-1">
              <span className="text-sm font-medium">
                My transparent balance
                {namadaAccount && (
                  <span className="text-muted-foreground font-normal ml-2 font-mono">
                    ({truncateAddress(namadaAccount, 8, 4)})
                  </span>
                )}
              </span>
              {!namadaConnected && (
                <p className="text-xs text-muted-foreground mt-1">
                  Connect your Namada wallet to use this option
                </p>
              )}
            </div>
          </label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem
            value="custom"
            id="custom"
            disabled={isAnyTxActive}
            className="mt-0.5"
          />
          <label
            htmlFor="custom"
            className="flex-1 cursor-pointer"
          >
            <span className="text-sm font-medium">Set a custom recipient</span>
          </label>
        </div>
      </RadioGroup>

      {/* Show address input only when custom recipient is selected */}
      {recipientType === 'custom' && (
        <RecipientAddressInput
          value={address}
          onChange={onAddressChange}
          onNameChange={onRecipientNameChange}
          onNameValidationChange={onNameValidationChange}
          addressType="namada"
          validationError={validationError}
          autoFillAddress={namadaAccount}
          onAutoFill={onAutoFill}
          disabled={isAnyTxActive}
        />
      )}

      {recipientType === 'transparent' && !namadaConnected && (
        <div className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-warning" />
            <p className="text-sm text-foreground">
              Please connect your Namada wallet to deposit to your transparent balance, or select "Use a custom recipient" to enter an address manually.
            </p>
          </div>
        </div>
      )}

      {/* Validation error for transparent address */}
      {recipientType === 'transparent' && validationError && address.trim() !== '' && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span className="flex-1">{validationError}</span>
        </div>
      )}

      <NobleFallbackAddressSection
        showAdvanced={showAdvanced}
        fallbackSelection={fallbackSelection}
        useCustomOverride={useCustomOverride}
        onCustomOverrideChange={onCustomOverrideChange}
        derivationState={derivationState}
        onDerive={onDerive}
        registrationStatus={registrationStatus}
        isAnyTxActive={isAnyTxActive}
        hasAddressError={!!validationError}
        recipientAddress={address}
        metaMaskConnected={metaMaskConnected}
        metaMaskAccount={metaMaskAccount}
      />
    </div>
  )
}

