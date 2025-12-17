import { useState, memo, useEffect } from 'react'
import { Clock, AlertCircle, Trash2, ArrowDownLeft, ArrowUpRight, MoreVertical, User } from 'lucide-react'
import type { StoredTransaction } from '@/services/tx/transactionStorageService'
import {
  isInProgress,
  isSuccess,
  isError,
  getStatusLabel,
  getTimeElapsed,
  getProgressPercentage,
  getEffectiveStatus,
  hasClientTimeout,
  getTimeoutMessage,
} from '@/services/tx/transactionStatusService'
import { TransactionDetailModal } from './TransactionDetailModal'
import { DeleteTransactionConfirmationDialog } from './DeleteTransactionConfirmationDialog'
import { DropdownMenu, DropdownMenuItem } from '@/components/common/DropdownMenu'
import { cn } from '@/lib/utils'
import { fetchEvmChainsConfig } from '@/services/config/chainConfigService'
import { findChainByKey } from '@/config/chains'
import type { EvmChainsFile } from '@/config/chains'
import { getAddressDisplay } from '@/utils/addressDisplayUtils'

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

  // Helper function to get chain display name from chain key
  const getChainDisplayName = (chainKey: string | undefined): string => {
    if (!chainKey) return ''
    
    // Look up by chain key in evm-chains.json
    if (evmChainsConfig) {
      const chain = findChainByKey(evmChainsConfig, chainKey)
      if (chain) {
        return chain.name
      }
      
      // If not found by key, try to find by name (in case chainKey is already a display name)
      const foundByName = evmChainsConfig.chains.find(
        chain => chain.name.toLowerCase() === chainKey.toLowerCase()
      )
      if (foundByName) {
        return foundByName.name
      }
    }
    
    // Fallback to the chain key itself
    return chainKey
  }


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

  // Get amount from transaction metadata
  let amount: string | undefined
  if (transaction.flowMetadata) {
    const amountInBase = transaction.flowMetadata.amount
    if (amountInBase) {
      const amountInUsdc = (parseInt(amountInBase) / 1_000_000).toFixed(2)
      amount = `${amountInUsdc} USDC`
    }
  } else if (transaction.depositDetails) {
    amount = `${transaction.depositDetails.amount} USDC`
  } else if (transaction.paymentDetails) {
    amount = `${transaction.paymentDetails.amount} USDC`
  }

  // Status color and badge styling
  let badgeBgColor = 'bg-muted'
  let badgeTextColor = 'text-muted-foreground'
  let badgeBorderColor = 'border-muted'

  const effectiveStatus = getEffectiveStatus(transaction)
  const inProgress = isInProgress(transaction)
  
  if (isSuccess(transaction)) {
    badgeBgColor = 'bg-success/20'
    badgeTextColor = 'text-success'
    badgeBorderColor = 'border-success/30'
  } else if (isError(transaction)) {
    badgeBgColor = 'bg-error/20'
    badgeTextColor = 'text-error'
    badgeBorderColor = 'border-error/30'
  } else if (effectiveStatus === 'user_action_required') {
    badgeBgColor = 'bg-warning/20'
    badgeTextColor = 'text-warning'
    badgeBorderColor = 'border-warning/30'
  } else if (effectiveStatus === 'undetermined') {
    badgeBgColor = 'bg-warning/20'
    badgeTextColor = 'text-warning'
    badgeBorderColor = 'border-warning/30'
  } else if (inProgress) {
    // In progress/broadcasted
    badgeBgColor = 'bg-muted'
    badgeTextColor = 'text-muted-foreground'
    badgeBorderColor = 'border-muted'
  }

  // Icon color styling based on status
  let iconBgColor: string
  let iconTextColor: string
  
  if (isError(transaction)) {
    // Failed/error status
    iconBgColor = 'bg-error/10'
    iconTextColor = 'text-error'
  } else if (effectiveStatus === 'undetermined' || hasClientTimeout(transaction)) {
    // Timeout/undetermined status
    iconBgColor = 'bg-warning/10'
    iconTextColor = 'text-warning'
  } else {
    // Default colors based on transaction direction
    iconBgColor = transaction.direction === 'deposit' ? 'bg-primary/10' : 'bg-info/10'
    iconTextColor = transaction.direction === 'deposit' ? 'text-primary' : 'text-info'
  }

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
              {/* Transaction type icon - smaller for dashboard */}
              <div className="flex-shrink-0">
                {transaction.direction === 'deposit' ? (
                  <div className={cn("flex h-8 w-8 items-center justify-center rounded-md", iconBgColor)}>
                    <ArrowDownLeft className={cn("h-6 w-6", iconTextColor)} />
                  </div>
                ) : (
                  <div className={cn("flex h-8 w-8 items-center justify-center rounded-md", iconBgColor)}>
                    <ArrowUpRight className={cn("h-6 w-6", iconTextColor)} />
                  </div>
                )}
              </div>
              
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-medium capitalize truncate">
                  {transaction.direction === 'deposit' ? 'Deposit' : 'Payment'}
                </span>
                {addressDisplayInfo && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground truncate">
                    <span>{transaction.direction === 'deposit' ? 'From: ' : 'To: '}</span>
                    {addressDisplayInfo.isFromAddressBook && (
                      <User className="h-3 w-3 text-success flex-shrink-0" />
                    )}
                    <span className="truncate">{addressDisplayInfo.display}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Column 2: Amount and chain */}
            <div className="flex flex-col items-center min-w-0">
              {amount && (
                <span className="text-sm font-medium">{amount}</span>
              )}
              <span className="text-xs text-muted-foreground truncate">
                {transaction.direction === 'deposit' 
                  ? getChainDisplayName(transaction.chain)
                  : getChainDisplayName(transaction.paymentDetails?.chainName || transaction.chain)
                }
              </span>
            </div>

            {/* Column 3: Status and time - stacked vertically */}
            <div className="flex flex-col items-end gap-1 min-w-0">
              {/* Status badge */}
              <div className="flex items-center gap-1.5">
                <div className={cn(
                  'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5',
                  badgeBgColor,
                  badgeTextColor,
                  badgeBorderColor
                )}>
                  <span className="text-[10px] font-medium leading-tight">{statusLabel}</span>
                </div>
                
                {hasClientTimeout(transaction) && (
                  <div className="group relative">
                    <AlertCircle className="h-3 w-3 text-warning" />
                    <div className="absolute bottom-full left-1/2 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-2 py-1 text-xs text-background opacity-0 shadow-lg transition-opacity group-hover:block group-hover:opacity-100">
                      {getTimeoutMessage(transaction)}
                    </div>
                  </div>
                )}
              </div>
              
              {/* Time with clock icon - smaller */}
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span>{timeElapsed}</span>
              </div>
              
              {/* Progress bar (for in-progress transactions) */}
              {isInProgress(transaction) && (
                <div className="w-full max-w-24 space-y-0.5">
                  <div className="h-1 w-full overflow-hidden rounded-md bg-muted">
                    <div
                      className="h-full bg-accent transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
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
              {/* Transaction type icon */}
              <div className="flex-shrink-0">
                {transaction.direction === 'deposit' ? (
                  <div className={cn("flex h-8 w-8 items-center justify-center rounded-md", iconBgColor)}>
                    <ArrowDownLeft className={cn("h-6 w-6", iconTextColor)} />
                  </div>
                ) : (
                  <div className={cn("flex h-8 w-8 items-center justify-center rounded-md", iconBgColor)}>
                    <ArrowUpRight className={cn("h-6 w-6", iconTextColor)} />
                  </div>
                )}
              </div>
              
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-medium capitalize truncate">
                  {transaction.direction === 'deposit' ? 'Deposit' : 'Payment'}
                </span>
                {addressDisplayInfo && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground truncate">
                    <span>{transaction.direction === 'deposit' ? 'From: ' : 'To: '}</span>
                    {addressDisplayInfo.isFromAddressBook && (
                      <User className="h-3 w-3 text-success flex-shrink-0" />
                    )}
                    <span className="truncate">{addressDisplayInfo.display}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Column 2: Amount & Status - Amount, chain, status and progress */}
            <div className="flex flex-col gap-2 min-w-0">
              {/* Amount and Chain on same line */}
              <div className="flex items-center gap-2 min-w-0">
                {amount && (
                  <span className="text-sm font-medium">{amount}</span>
                )}
                <span className="text-xs text-muted-foreground truncate">
                  {transaction.direction === 'deposit' 
                    ? getChainDisplayName(transaction.chain)
                    : getChainDisplayName(transaction.paymentDetails?.chainName || transaction.chain)
                  }
                </span>
              </div>
              
              {/* Status */}
              <div className="flex flex-col gap-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Pill-shaped status badge */}
                  <div className={cn(
                    'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5',
                    badgeBgColor,
                    badgeTextColor,
                    badgeBorderColor
                  )}>
                    <span className="text-[10px] font-medium">{statusLabel}</span>
                  </div>
                  
                  {hasClientTimeout(transaction) && (
                    <div className="group relative">
                      <AlertCircle className="h-3.5 w-3.5 text-warning" />
                      <div className="absolute bottom-full left-1/2 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-2 py-1 text-xs text-background opacity-0 shadow-lg transition-opacity group-hover:block group-hover:opacity-100">
                        {getTimeoutMessage(transaction)}
                      </div>
                    </div>
                  )}
                </div>

                {/* Progress bar (for in-progress transactions) */}
                {isInProgress(transaction) && (
                  <div className="w-full max-w-48">
                    <div className="h-1.5 w-full overflow-hidden rounded-md bg-muted">
                      <div
                        className="h-full bg-accent transition-all duration-300"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Column 3: Time - Only shown in detailed view when actions are visible */}
            {!hideActions && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
                <Clock className="h-3.5 w-3.5 flex-shrink-0" />
                <span>{timeElapsed}</span>
              </div>
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

