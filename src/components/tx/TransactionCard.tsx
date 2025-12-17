import { useState, memo, useEffect } from 'react'
import { Trash2, MoreVertical } from 'lucide-react'
import type { StoredTransaction } from '@/services/tx/transactionStorageService'
import {
  isInProgress,
  getStatusLabel,
  getTimeElapsed,
  getProgressPercentage,
  hasClientTimeout,
  getTimeoutMessage,
} from '@/services/tx/transactionStatusService'
import { TransactionDetailModal } from './TransactionDetailModal'
import { DeleteTransactionConfirmationDialog } from './DeleteTransactionConfirmationDialog'
import { DropdownMenu, DropdownMenuItem } from '@/components/common/DropdownMenu'
import { cn } from '@/lib/utils'
import { fetchEvmChainsConfig } from '@/services/config/chainConfigService'
import type { EvmChainsFile } from '@/config/chains'
import { getAddressDisplay } from '@/utils/addressDisplayUtils'
import { getChainDisplayNameFromKey } from '@/utils/chainUtils'
import { extractTransactionAmount } from '@/utils/transactionUtils'
import { getStatusBadgeClasses, getTransactionIconClasses } from '@/utils/transactionStatusStyles'
import { TransactionTypeIcon } from './TransactionTypeIcon'
import { TransactionStatusBadge } from './TransactionStatusBadge'
import { TransactionProgressBar } from './TransactionProgressBar'
import { TransactionAddressRow } from './TransactionAddressRow'
import { TransactionAmountDisplay } from './TransactionAmountDisplay'
import { TransactionTimeDisplay } from './TransactionTimeDisplay'

export interface TransactionCardProps {
  transaction: StoredTransaction
  variant?: 'compact' | 'detailed'
  onClick?: () => void
  showExpandButton?: boolean
  onDelete?: (txId: string) => void
  hideActions?: boolean // Hide the actions column (dropdown menu)
  // Optional external modal state control (for persistence across component remounts)
  isModalOpen?: boolean
  onModalOpenChange?: (open: boolean) => void
}

export const TransactionCard = memo(function TransactionCard({
  transaction,
  variant = 'compact',
  onClick,
  showExpandButton = true,
  onDelete,
  hideActions = false,
  isModalOpen: externalIsModalOpen,
  onModalOpenChange,
}: TransactionCardProps) {
  // Use external modal state if provided, otherwise use internal state
  const [internalIsModalOpen, setInternalIsModalOpen] = useState(false)
  const isModalOpen = externalIsModalOpen !== undefined ? externalIsModalOpen : internalIsModalOpen
  const setIsModalOpen = onModalOpenChange || setInternalIsModalOpen
  
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [evmChainsConfig, setEvmChainsConfig] = useState<EvmChainsFile | null>(null)

  // Load EVM chains config to resolve chain display names
  useEffect(() => {
    let mounted = true

    async function loadConfig() {
      try {
        const config = await fetchEvmChainsConfig()
        if (mounted) {
          setEvmChainsConfig(config)
        }
      } catch (error) {
        console.error('[TransactionCard] Failed to load EVM chains config:', error)
      }
    }

    void loadConfig()

    return () => {
      mounted = false
    }
  }, [])

  // Get the address to display
  const displayAddress = transaction.direction === 'deposit'
    ? transaction.depositDetails?.senderAddress
    : transaction.paymentDetails?.destinationAddress
  
  const addressDisplayInfo = getAddressDisplay(displayAddress)

  const handleClick = () => {
    if (onClick) {
      onClick()
    } else if (showExpandButton) {
      setIsModalOpen(true)
    }
  }

  const handleDeleteConfirm = () => {
    if (onDelete) {
      onDelete(transaction.id)
    }
  }

  const flowType = transaction.direction === 'deposit' ? 'deposit' : 'payment'
  const statusLabel = getStatusLabel(transaction)
  const timeElapsed = getTimeElapsed(transaction)
  const progress = getProgressPercentage(transaction, flowType)

  // Extract amount using utility function
  const amount = extractTransactionAmount(transaction)

  // Get status badge and icon classes using utility functions
  const badgeClasses = getStatusBadgeClasses(transaction)
  const iconClasses = getTransactionIconClasses(transaction)

  // Get chain display name
  const chainName = transaction.direction === 'deposit'
    ? getChainDisplayNameFromKey(transaction.chain, evmChainsConfig) || ''
    : getChainDisplayNameFromKey(transaction.paymentDetails?.chainName || transaction.chain, evmChainsConfig) || ''

  return (
    <>
      <div
        className={cn(
          'card',
          variant === 'compact' 
            ? 'card-sm card-no-border' 
            : 'card-no-border',
          onClick || showExpandButton ? 'cursor-pointer' : '',
        )}
        onClick={handleClick}
      >
        {/* Dashboard compact layout (when hideActions is true and variant is compact) */}
        {hideActions && variant === 'compact' ? (
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            {/* Column 1: Transaction - Type and source chain */}
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex-shrink-0">
                <TransactionTypeIcon
                  direction={transaction.direction}
                  iconBgColor={iconClasses.bg}
                  iconTextColor={iconClasses.text}
                />
              </div>
              
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-medium capitalize truncate">
                  {transaction.direction === 'deposit' ? 'Deposit' : 'Payment'}
                </span>
                <TransactionAddressRow
                  addressDisplayInfo={addressDisplayInfo}
                  direction={transaction.direction}
                />
              </div>
            </div>

            {/* Column 2: Amount and chain */}
            <TransactionAmountDisplay
              amount={amount}
              chainName={chainName}
              layout="vertical"
            />

            {/* Column 3: Status and time - stacked vertically */}
            <div className="flex flex-col items-end gap-1 min-w-0">
              <TransactionStatusBadge
                statusLabel={statusLabel}
                hasTimeout={hasClientTimeout(transaction)}
                timeoutMessage={hasClientTimeout(transaction) ? (getTimeoutMessage(transaction) || undefined) : undefined}
                size="sm"
                variant="rounded-sm"
                badgeClasses={badgeClasses}
              />
              
              <TransactionTimeDisplay
                timeElapsed={timeElapsed}
                size="sm"
              />
              
              {isInProgress(transaction) && (
                <TransactionProgressBar
                  progress={progress}
                  maxWidth="max-w-24"
                  height="sm"
                />
              )}
            </div>
          </div>
        ) : (
          <div className={cn(
            'grid items-center',
            hideActions ? 'grid-cols-[1fr_1fr]' : 'grid-cols-[1fr_1fr_1fr_auto]',
            variant === 'compact' ? 'gap-3' : 'gap-4'
          )}>
            {/* Column 1: Transaction - Type and source chain */}
            <div className="flex items-center gap-4 min-w-0">
              <div className="flex-shrink-0">
                <TransactionTypeIcon
                  direction={transaction.direction}
                  iconBgColor={iconClasses.bg}
                  iconTextColor={iconClasses.text}
                />
              </div>
              
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-medium capitalize truncate">
                  {transaction.direction === 'deposit' ? 'Deposit' : 'Payment'}
                </span>
                <TransactionAddressRow
                  addressDisplayInfo={addressDisplayInfo}
                  direction={transaction.direction}
                />
              </div>
            </div>

            {/* Column 2: Amount & Status - Amount, chain, status and progress */}
            <div className="flex flex-col gap-2 min-w-0">
              <TransactionAmountDisplay
                amount={amount}
                chainName={chainName}
                layout="horizontal"
              />
              
              <div className="flex flex-col gap-1 min-w-0">
                <TransactionStatusBadge
                  statusLabel={statusLabel}
                  hasTimeout={hasClientTimeout(transaction)}
                  timeoutMessage={hasClientTimeout(transaction) ? (getTimeoutMessage(transaction) || undefined) : undefined}
                  size="md"
                  variant="rounded-md"
                  badgeClasses={badgeClasses}
                />

                {isInProgress(transaction) && (
                  <TransactionProgressBar
                    progress={progress}
                    maxWidth="max-w-48"
                    height="md"
                  />
                )}
              </div>
            </div>

            {/* Column 3: Time - Only shown in detailed view when actions are visible */}
            {!hideActions && (
              <TransactionTimeDisplay
                timeElapsed={timeElapsed}
                size="md"
              />
            )}

            {/* Column 4: Actions - Action icons */}
            {!hideActions && (
              <div className="flex items-center gap-2 flex-shrink-0">
                {onDelete && (
                  <DropdownMenu
                    trigger={
                      <button
                        type="button"
                        className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground hover:bg-muted/80 transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
                        aria-label="Transaction actions"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    }
                    align="right"
                  >
                    <DropdownMenuItem
                      onClick={() => {
                        setIsDeleteDialogOpen(true)
                      }}
                      stopPropagation
                      className="text-destructive hover:bg-destructive/10"
                    >
                      <div className="flex items-center gap-2">
                        <Trash2 className="h-4 w-4" />
                        <span>Delete</span>
                      </div>
                    </DropdownMenuItem>
                  </DropdownMenu>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {showExpandButton && (
        <TransactionDetailModal
          transaction={transaction}
          open={isModalOpen}
          onClose={() => setIsModalOpen(false)}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {onDelete && (
        <DeleteTransactionConfirmationDialog
          open={isDeleteDialogOpen}
          onClose={() => setIsDeleteDialogOpen(false)}
          onConfirm={handleDeleteConfirm}
          transactionType={transaction.direction}
        />
      )}
    </>
  )
})
