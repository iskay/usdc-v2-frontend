import { useAtomValue } from 'jotai'
import { User, Ghost, Info } from 'lucide-react'
import { ExplorerLink } from '@/components/common/ExplorerLink'
import { CopyButton } from '@/components/common/CopyButton'
import type { StoredTransaction } from '@/services/tx/transactionStorageService'
import { getAddressDisplay, isDisposableNamadaAddress } from '@/utils/addressDisplayUtils'
import { Tooltip } from '@/components/common/Tooltip'
import { formatAddress } from '@/utils/toastHelpers'
import { addressBookAtom } from '@/atoms/addressBookAtom'

export interface AddressDisplaySectionProps {
  address: string | undefined
  label: string
  explorerUrl?: string
  isSender?: boolean
  showAddress: boolean
  onToggleShowAddress: () => void
  transaction: StoredTransaction
}

export function AddressDisplaySection({
  address,
  label,
  explorerUrl,
  isSender = false,
  showAddress,
  onToggleShowAddress,
  transaction,
}: AddressDisplaySectionProps) {
  if (!address) return null

  const addressBookEntries = useAtomValue(addressBookAtom)
  const addressInfo = getAddressDisplay(address, addressBookEntries)
  const isDisposable = isSender && isDisposableNamadaAddress(address, transaction)
  const isFromAddressBook = addressInfo?.isFromAddressBook ?? false

  // Always show the label at the top
  return (
    <div className="space-y-2">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      
      {/* Case 1: No address book match and not disposable - show address directly */}
      {!isFromAddressBook && !isDisposable && (
        <dd>
          <div className="flex items-center justify-start gap-2">
            <span className="text-sm font-mono">{formatAddress(address)}</span>
            <div className="gap-0 flex">
              <CopyButton
                text={address}
                label={label}
                size='md'
              />
              {explorerUrl && (
                <ExplorerLink
                  url={explorerUrl}
                  label={`Open ${label} in explorer`}
                  size='md'
                  iconOnly
                  className="explorer-link-inline"
                />
              )}
            </div>
          </div>
        </dd>
      )}

      {/* Case 2: Address book match */}
      {isFromAddressBook && !isDisposable && addressInfo && (
        <>
          <dd>
            <div className="flex items-center gap-1 text-md">
              <User className="h-4 w-4 text-success flex-shrink-0" />
              <span className="font-semibold">{addressInfo.display}</span>
            </div>
          </dd>
          {!showAddress ? (
            <button
              type="button"
              onClick={onToggleShowAddress}
              className="text-xs text-primary hover:text-primary/80 p-0"
            >
              Show address
            </button>
          ) : (
            <dd>
              <div className="flex items-center justify-start gap-2">
                <span className="text-xs text-muted-foreground font-mono">{formatAddress(address)}</span>
                <div className="gap-0 flex">
                  <CopyButton
                    text={address}
                    label={label}
                    size='sm'
                  />
                  {explorerUrl && (
                    <ExplorerLink
                      url={explorerUrl}
                      label={`Open ${label} in explorer`}
                      size='sm'
                      iconOnly
                      className="explorer-link-inline"
                    />
                  )}
                </div>
              </div>
            </dd>
          )}
        </>
      )}

      {/* Case 3: Disposable */}
      {isDisposable && (
        <>
          <dd>
            <Tooltip
              content="An unlinked address created only for sending a single shielded transaction"
              side="top"
            >
              <div className="flex items-center gap-2 text-md font-medium">
                <Ghost className="h-4 w-4 flex-shrink-0 text-success" />
                <span>Disposable address</span>
                <Info className="h-3 w-3 text-muted-foreground" />
              </div>
            </Tooltip>
          </dd>
          {!showAddress ? (
            <button
              type="button"
              onClick={onToggleShowAddress}
              className="text-xs text-primary hover:text-primary/80 p-0"
            >
              Show address
            </button>
          ) : (
            <dd>
              <div className="flex items-center justify-start gap-2">
                <span className="text-xs text-muted-foreground font-mono">{formatAddress(address)}</span>
                <div className="gap-0 flex">
                  <CopyButton
                    text={address}
                    label={label}
                    size='sm'
                  />
                  {explorerUrl && (
                    <ExplorerLink
                      url={explorerUrl}
                      label={`Open ${label} in explorer`}
                      size='sm'
                      iconOnly
                      className="explorer-link-inline"
                    />
                  )}
                </div>
              </div>
            </dd>
          )}
        </>
      )}
    </div>
  )
}

