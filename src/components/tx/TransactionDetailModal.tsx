import { useEffect, useState, useCallback } from 'react'
import { X, CheckCircle2, XCircle, Clock, AlertCircle, Copy, ExternalLink } from 'lucide-react'
import type { StoredTransaction } from '@/services/tx/transactionStorageService'
import {
  isInProgress,
  isSuccess,
  isError,
  getStatusLabel,
  getEffectiveStatus,
  getTotalDurationLabel,
  getProgressPercentage,
  getStageTimings,
  getCurrentStage,
  hasClientTimeout,
} from '@/services/tx/transactionStatusService'
import { ChainStatusTimeline } from '@/components/polling/ChainStatusTimeline'
import { ResumePollingButton } from '@/components/polling/ResumePollingButton'
import { CancelPollingButton } from '@/components/polling/CancelPollingButton'
import { RetryPollingButton } from '@/components/polling/RetryPollingButton'
import { RegisterNobleForwardingButton } from '@/components/polling/RegisterNobleForwardingButton'
import { cn } from '@/lib/utils'
import { fetchEvmChainsConfig } from '@/services/config/chainConfigService'
import { fetchTendermintChainsConfig } from '@/services/config/tendermintChainConfigService'
import type { EvmChainsFile, TendermintChainsFile } from '@/config/chains'
import { findChainByKey } from '@/config/chains'
import { findTendermintChainByKey, getDefaultNamadaChainKey } from '@/config/chains'
import { useToast } from '@/hooks/useToast'
import { buildCopySuccessToast, buildCopyErrorToast } from '@/utils/toastHelpers'

export interface TransactionDetailModalProps {
  transaction: StoredTransaction
  open: boolean
  onClose: () => void
}

export function TransactionDetailModal({
  transaction,
  open,
  onClose,
}: TransactionDetailModalProps) {
  const { notify } = useToast()
  const [evmChainsConfig, setEvmChainsConfig] = useState<EvmChainsFile | null>(null)
  const [tendermintChainsConfig, setTendermintChainsConfig] = useState<TendermintChainsFile | null>(null)

  // Load chain configs when modal opens
  useEffect(() => {
    if (!open) return

    let mounted = true

    async function loadConfigs() {
      try {
        const [evmConfig, tendermintConfig] = await Promise.all([
          fetchEvmChainsConfig(),
          fetchTendermintChainsConfig(),
        ])
        if (mounted) {
          setEvmChainsConfig(evmConfig)
          setTendermintChainsConfig(tendermintConfig)
        }
      } catch (error) {
        console.error('[TransactionDetailModal] Failed to load chain configs:', error)
      }
    }

    void loadConfigs()

    return () => {
      mounted = false
    }
  }, [open])

  // Handle Escape key to close modal
  useEffect(() => {
    if (!open) return

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open, onClose])

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }

    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  // Copy to clipboard helper
  const copyToClipboard = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      notify(buildCopySuccessToast(label))
    } catch (error) {
      console.error('[TransactionDetailModal] Failed to copy to clipboard:', error)
      notify(buildCopyErrorToast())
    }
  }, [notify])

  // Helper to get EVM chain key from chain name or transaction chain
  const getEvmChainKey = useCallback((chainName?: string, transactionChain?: string): string | undefined => {
    if (!evmChainsConfig) return transactionChain

    // First try to find by chain name (case-insensitive)
    if (chainName) {
      const normalizedName = chainName.toLowerCase().replace(/\s+/g, '-')
      const foundByNormalized = evmChainsConfig.chains.find(
        chain => chain.key.toLowerCase() === normalizedName
      )
      if (foundByNormalized) return foundByNormalized.key

      // Try to find by display name
      const foundByName = evmChainsConfig.chains.find(
        chain => chain.name.toLowerCase() === chainName.toLowerCase()
      )
      if (foundByName) return foundByName.key
    }

    // Fallback to transaction chain if it looks like a valid key
    if (transactionChain) {
      const foundByChain = evmChainsConfig.chains.find(
        chain => chain.key === transactionChain
      )
      if (foundByChain) return foundByChain.key
    }

    return transactionChain
  }, [evmChainsConfig])

  // Helper to get chain display name from chain key ('evm', 'noble', 'namada')
  const getChainDisplayName = useCallback((chainKey: 'evm' | 'noble' | 'namada'): string => {
    if (chainKey === 'noble') {
      return 'Noble'
    }
    if (chainKey === 'namada') {
      return 'Namada'
    }
    // For EVM, get the actual chain name from transaction details
    if (chainKey === 'evm') {
      const chainName = transaction.depositDetails?.chainName || transaction.paymentDetails?.chainName
      if (chainName && evmChainsConfig) {
        // Try to find chain by name
        const chain = evmChainsConfig.chains.find(
          c => c.name.toLowerCase() === chainName.toLowerCase() || c.key === chainName
        )
        if (chain) {
          return chain.name
        }
        // If not found, return the chainName as-is (might already be display name)
        return chainName
      }
      // Fallback: try to get from transaction.chain
      if (transaction.chain && evmChainsConfig) {
        const chain = findChainByKey(evmChainsConfig, transaction.chain)
        if (chain) {
          return chain.name
        }
      }
      return 'EVM'
    }
    // All cases handled above, this should never be reached
    return 'Unknown'
  }, [transaction, evmChainsConfig])

  // Build explorer URL helper
  const buildExplorerUrl = useCallback((
    value: string,
    type: 'address' | 'tx',
    chainType: 'evm' | 'namada' | 'noble',
    chainKey?: string
  ): string | undefined => {
    if (type === 'address') {
      if (chainType === 'evm') {
        const chain = chainKey && evmChainsConfig ? findChainByKey(evmChainsConfig, chainKey) : null
        if (chain?.explorer?.baseUrl) {
          const addressPath = chain.explorer.addressPath ?? 'address'
          return `${chain.explorer.baseUrl}/${addressPath}/${value}`
        }
      } else if (chainType === 'namada') {
        const namadaChainKey = tendermintChainsConfig ? getDefaultNamadaChainKey(tendermintChainsConfig) : 'namada-testnet'
        const chain = tendermintChainsConfig ? findTendermintChainByKey(tendermintChainsConfig, namadaChainKey || 'namada-testnet') : null
        if (chain?.explorer?.baseUrl) {
          const addressPath = chain.explorer.addressPath ?? 'account'
          return `${chain.explorer.baseUrl}/${addressPath}/${value}`
        }
      } else if (chainType === 'noble') {
        const chain = tendermintChainsConfig ? findTendermintChainByKey(tendermintChainsConfig, 'noble-testnet') : null
        if (chain?.explorer?.baseUrl) {
          const addressPath = chain.explorer.addressPath ?? 'account'
          return `${chain.explorer.baseUrl}/${addressPath}/${value}`
        }
      }
    } else if (type === 'tx') {
      const lowercasedHash = value.toLowerCase()
      if (chainType === 'evm') {
        const chain = chainKey && evmChainsConfig ? findChainByKey(evmChainsConfig, chainKey) : null
        if (chain?.explorer?.baseUrl) {
          const txPath = chain.explorer.txPath ?? 'tx'
          return `${chain.explorer.baseUrl}/${txPath}/${lowercasedHash}`
        }
      } else if (chainType === 'namada') {
        const namadaChainKey = tendermintChainsConfig ? getDefaultNamadaChainKey(tendermintChainsConfig) : 'namada-testnet'
        const chain = tendermintChainsConfig ? findTendermintChainByKey(tendermintChainsConfig, namadaChainKey || 'namada-testnet') : null
        if (chain?.explorer?.baseUrl) {
          const txPath = chain.explorer.txPath ?? 'tx'
          return `${chain.explorer.baseUrl}/${txPath}/${lowercasedHash}`
        }
      } else if (chainType === 'noble') {
        const chain = tendermintChainsConfig ? findTendermintChainByKey(tendermintChainsConfig, 'noble-testnet') : null
        if (chain?.explorer?.baseUrl) {
          const txPath = chain.explorer.txPath ?? 'tx'
          return `${chain.explorer.baseUrl}/${txPath}/${lowercasedHash}`
        }
      }
    }
    return undefined
  }, [evmChainsConfig, tendermintChainsConfig])

  if (!open) {
    return null
  }

  const flowType = transaction.direction === 'deposit' ? 'deposit' : 'payment'
  const statusLabel = getStatusLabel(transaction)
  const totalDuration = getTotalDurationLabel(transaction)
  const progress = getProgressPercentage(transaction, flowType)
  const stageTimings = getStageTimings(transaction, flowType)
  const currentStage = getCurrentStage(transaction, flowType)

  // Format started at timestamp
  const startedAt = new Date(transaction.createdAt).toLocaleString()

  // Get amount from transaction metadata
  let amount: string | undefined
  if (transaction.flowMetadata) {
    const amountInBase = transaction.flowMetadata.amount
    if (amountInBase) {
      const amountInUsdc = (parseInt(amountInBase) / 1_000_000).toFixed(2)
      amount = `$${amountInUsdc}`
    }
  } else if (transaction.depositDetails) {
    amount = `$${transaction.depositDetails.amount}`
  } else if (transaction.paymentDetails) {
    amount = `$${transaction.paymentDetails.amount}`
  }

  // Build route string
  let route: string
  if (transaction.direction === 'deposit') {
    // Deposits: {evm source chain} → Noble → Namada
    const evmChainName = transaction.depositDetails?.chainName || transaction.chain
    route = `${evmChainName} → Noble → Namada`
  } else {
    // Payments: Namada → Noble → {evm destination chain}
    const evmChainName = transaction.paymentDetails?.chainName || transaction.chain
    route = `Namada → Noble → ${evmChainName}`
  }

  // Get receiver address
  const receiverAddress = transaction.depositDetails?.destinationAddress || transaction.paymentDetails?.destinationAddress

  // Get sender address
  // For payments: sender is the Namada transparent address (from shieldedMetadata)
  // For deposits: sender is the EVM address (from depositDetails)
  let senderAddress: string | undefined
  if (transaction.direction === 'deposit') {
    senderAddress = transaction.depositDetails?.senderAddress
  } else if (transaction.direction === 'send') {
    senderAddress = transaction.flowMetadata?.shieldedMetadata?.transparentAddress
  }

  // Get send and receive transaction hashes
  let sendTxHash: string | undefined
  let receiveTxHash: string | undefined

  // Check pollingState for transaction hashes
  if (transaction.pollingState) {
    const { chainStatus } = transaction.pollingState
    if (transaction.direction === 'deposit') {
      // Deposits: Send Tx = evm, Receive Tx = namadaTxHash from metadata
      if (!sendTxHash) {
        sendTxHash = chainStatus.evm?.metadata?.txHash as string | undefined ||
          chainStatus.evm?.stages?.find(s => s.txHash)?.txHash
      }
      if (!receiveTxHash) {
        // For deposits, receive tx is the namadaTxHash from metadata (the transaction hash after IBC transfer completes)
        receiveTxHash = transaction.pollingState.metadata?.namadaTxHash as string | undefined ||
          chainStatus.namada?.metadata?.txHash as string | undefined ||
          chainStatus.namada?.stages?.find(s => s.stage === 'namada_received' && s.txHash)?.txHash
      }
    } else {
      // Payments: Send Tx = namada, Receive Tx = evm
      if (!sendTxHash) {
        sendTxHash = chainStatus.namada?.metadata?.txHash as string | undefined ||
          chainStatus.namada?.stages?.find(s => s.txHash)?.txHash
      }
      if (!receiveTxHash) {
        receiveTxHash = chainStatus.evm?.metadata?.txHash as string | undefined ||
          chainStatus.evm?.stages?.find(s => s.txHash)?.txHash
      }
    }
  }

  // Fallback to transaction.hash if neither source has the send hash
  if (!sendTxHash && transaction.hash) {
    sendTxHash = transaction.hash
  }

  // Status icon and color
  let statusIcon = <Clock className="h-5 w-5" />
  let statusColor = 'text-muted-foreground'

  const effectiveStatus = getEffectiveStatus(transaction)
  
  if (isSuccess(transaction)) {
    statusIcon = <CheckCircle2 className="h-5 w-5" />
    statusColor = 'text-green-600'
  } else if (isError(transaction)) {
    statusIcon = <XCircle className="h-5 w-5" />
    statusColor = 'text-red-600'
  } else if (effectiveStatus === 'user_action_required') {
    statusIcon = <AlertCircle className="h-5 w-5" />
    statusColor = 'text-orange-600'
  } else if (effectiveStatus === 'undetermined') {
    statusIcon = <AlertCircle className="h-5 w-5" />
    statusColor = 'text-yellow-600'
  }


  // Format address for display (truncate middle)
  function formatAddress(address: string): string {
    if (address.length <= 10) return address
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  // Format transaction hash
  function formatHash(hash: string): string {
    if (hash.length <= 10) return hash
    return `${hash.slice(0, 8)}...${hash.slice(-6)}`
  }

  // Reusable InfoRow component for address/tx display
  function InfoRow({
    label,
    value,
    explorerUrl,
    onCopy,
  }: {
    label: string
    value: string
    explorerUrl?: string
    onCopy: () => void
  }) {
    return (
      <div className="col-span-2">
        <dt className="text-muted-foreground">{label}</dt>
        <dd className="mt-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm">{value}</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onCopy}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                aria-label={`Copy ${label}`}
                title={`Copy ${label}`}
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
              {explorerUrl && (
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  aria-label={`Open ${label} in explorer`}
                  title={`Open ${label} in explorer`}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </div>
        </dd>
      </div>
    )
  }

  // Noble Forwarding Registration Status component
  function NobleForwardingRegistrationStatus({
    reg,
    forwardingAddress,
    recipientAddress,
    channelId,
    fallback,
    txId,
  }: {
    reg: any
    forwardingAddress?: string
    recipientAddress?: string
    channelId?: string
    fallback?: string
    txId: string
  }) {
    let statusMessage
    if (reg.alreadyRegistered) {
      statusMessage = (
        <p className="mt-1 text-xs text-green-600">
          Already registered
        </p>
      )
    } else if (reg.registrationTx?.txHash) {
      statusMessage = (
        <p className="mt-1 text-xs text-green-600">
          Registered: {reg.registrationTx.txHash.slice(0, 16)}...
        </p>
      )
    } else if (reg.balanceCheck?.performed && !reg.balanceCheck.sufficient) {
      statusMessage = (
        <p className="mt-1 text-xs text-orange-600">
          Insufficient balance: {reg.balanceCheck.balanceUusdc || '0'} uusdc &lt; {reg.balanceCheck.minRequiredUusdc || '0'} uusdc required
        </p>
      )
    } else if (reg.errorMessage) {
      statusMessage = (
        <p className="mt-1 text-xs text-red-600">
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
      <div className="rounded-md border border-border bg-muted/50 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold">Noble Forwarding Registration</h4>
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Content */}
      <div className="relative z-50 w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg border border-border bg-background shadow-lg">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background p-6">
          <div className="flex items-center gap-3">
            <div className={cn('flex items-center gap-2', statusColor)}>
              {statusIcon}
              <h2 className="text-xl font-semibold">
                {transaction.direction === 'deposit' ? 'Deposit' : 'Payment'} Details
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Transaction Summary */}
          <div className="rounded-lg border border-border bg-muted/40 p-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-muted-foreground">Status</dt>
                <dd className={cn('mt-1 font-medium', statusColor)}>{statusLabel}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Started At</dt>
                <dd className="mt-1 font-medium">{startedAt}</dd>
              </div>
              {amount && (
                <div>
                  <dt className="text-muted-foreground">Amount</dt>
                  <dd className="mt-1 font-medium">{amount} USDC</dd>
                </div>
              )}
              <div>
                <dt className="text-muted-foreground">Route</dt>
                <dd className="mt-1 font-medium">{route}</dd>
              </div>
              {senderAddress && (
                <InfoRow
                  label="Sender Address"
                  value={formatAddress(senderAddress)}
                  explorerUrl={buildExplorerUrl(
                    senderAddress,
                    'address',
                    transaction.direction === 'deposit' ? 'evm' : 'namada',
                    transaction.direction === 'deposit'
                      ? getEvmChainKey(transaction.depositDetails?.chainName, transaction.chain)
                      : undefined
                  )}
                  onCopy={() => copyToClipboard(senderAddress, 'Sender Address')}
                />
              )}
              {receiverAddress && (
                <InfoRow
                  label="Receiver Address"
                  value={formatAddress(receiverAddress)}
                  explorerUrl={buildExplorerUrl(
                    receiverAddress,
                    'address',
                    transaction.direction === 'deposit' ? 'namada' : 'evm',
                    transaction.direction === 'send'
                      ? getEvmChainKey(transaction.paymentDetails?.chainName, transaction.chain)
                      : undefined
                  )}
                  onCopy={() => copyToClipboard(receiverAddress, 'Receiver Address')}
                />
              )}
              {sendTxHash && (
                <InfoRow
                  label="Send Tx"
                  value={formatHash(sendTxHash)}
                  explorerUrl={buildExplorerUrl(
                    sendTxHash,
                    'tx',
                    transaction.direction === 'deposit' ? 'evm' : 'namada',
                    transaction.direction === 'deposit'
                      ? getEvmChainKey(transaction.depositDetails?.chainName, transaction.chain)
                      : undefined
                  )}
                  onCopy={() => copyToClipboard(sendTxHash, 'Send Tx')}
                />
              )}
              {receiveTxHash && (
                <InfoRow
                  label="Receive Tx"
                  value={formatHash(receiveTxHash)}
                  explorerUrl={buildExplorerUrl(
                    receiveTxHash,
                    'tx',
                    transaction.direction === 'deposit' ? 'namada' : 'evm',
                    transaction.direction === 'send'
                      ? getEvmChainKey(transaction.paymentDetails?.chainName, transaction.chain)
                      : undefined
                  )}
                  onCopy={() => copyToClipboard(receiveTxHash, 'Receive Tx')}
                />
              )}
            </div>
          </div>

          {/* Progress Bar */}
          {isInProgress(transaction) && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Progress</span>
                <span className="font-medium">{progress}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Current Stage */}
          {currentStage && (
            <div className="rounded-md bg-muted/50 p-4">
              <div className="flex items-center gap-2 text-sm">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium capitalize">
                  Current Stage: {currentStage.stage.replace(/_/g, ' ')}
                </span>
                <span className="text-muted-foreground">on {getChainDisplayName(currentStage.chain)}</span>
              </div>
              {currentStage.durationLabel && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Time in this stage: {currentStage.durationLabel}
                </p>
              )}
            </div>
          )}

          {/* Chain Status Timeline (for frontend polling) */}
          {transaction.pollingState ? (
            <div className="space-y-4">
              <ChainStatusTimeline transaction={transaction} />
              
              {/* Polling Control Buttons */}
              <div className="flex items-center gap-2 pt-2">
                <RetryPollingButton transaction={transaction} size="sm" />
                <ResumePollingButton transaction={transaction} size="sm" />
                <CancelPollingButton transaction={transaction} size="sm" />
              </div>

              {/* Noble Forwarding Registration Status */}
              {transaction.pollingState.chainStatus.noble?.metadata?.nobleForwardingRegistration ? (
                <NobleForwardingRegistrationStatus
                  reg={transaction.pollingState.chainStatus.noble.metadata.nobleForwardingRegistration as any}
                  forwardingAddress={transaction.pollingState.metadata?.forwardingAddress as string | undefined}
                  recipientAddress={transaction.depositDetails?.destinationAddress || transaction.pollingState.metadata?.namadaReceiver as string | undefined}
                  channelId={transaction.pollingState.chainStatus.noble?.metadata?.channelId as string | undefined}
                  fallback={transaction.pollingState.chainStatus.noble?.metadata?.fallback as string | undefined}
                  txId={transaction.id}
                />
              ) : null}
            </div>
          ) : null}

          {/* Stage Timeline */}
          {stageTimings.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold uppercase text-muted-foreground">
                Stage Timeline
              </h3>
              <div className="space-y-3">
                {stageTimings.map((timing, index) => {
                  const isLast = index === stageTimings.length - 1
                  const timingIcon =
                    timing.status === 'confirmed' ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : timing.status === 'failed' ? (
                      <XCircle className="h-4 w-4 text-red-600" />
                    ) : (
                      <Clock className="h-4 w-4 text-muted-foreground" />
                    )

                  return (
                    <div key={`${timing.chain}-${timing.stage}-${index}`} className="relative pl-8">
                      {/* Timeline line */}
                      {!isLast && (
                        <div className="absolute left-3 top-6 h-full w-0.5 bg-border" />
                      )}

                      {/* Stage content */}
                      <div className="flex items-start gap-3">
                        <div className="relative z-10 -ml-8 flex h-6 w-6 items-center justify-center rounded-full bg-background">
                          {timingIcon}
                        </div>
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2 text-sm">
                            <span className="font-medium capitalize">
                              {timing.stage.replace(/_/g, ' ')}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              ({getChainDisplayName(timing.chain)})
                            </span>
                          </div>
                          {timing.durationLabel && (
                            <p className="text-xs text-muted-foreground">
                              Duration: {timing.durationLabel}
                            </p>
                          )}
                          {timing.occurredAt && (
                            <p className="text-xs text-muted-foreground">
                              {new Date(timing.occurredAt).toLocaleString()}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Error Message */}
          {transaction.errorMessage && (
            <div className="rounded-md border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
              <div className="flex items-start gap-2">
                <XCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-900 dark:text-red-100">Error</p>
                  <p className="mt-1 text-sm text-red-800 dark:text-red-200">
                    {transaction.errorMessage}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Client Timeout Notice */}
          {hasClientTimeout(transaction) && (
            <div className="rounded-md border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-950">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-yellow-900 dark:text-yellow-100">
                    Client-Side Polling Stopped
                  </p>
                  <p className="mt-1 text-sm text-yellow-800 dark:text-yellow-200">
                    Client-side polling stopped at{' '}
                    {transaction.clientTimeoutAt
                      ? new Date(transaction.clientTimeoutAt).toLocaleString()
                      : 'unknown time'}
                    . The backend is still tracking this transaction. Polling will resume automatically
                    when you refresh the page.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Undetermined Status Notice */}
          {transaction.status === 'undetermined' && (
            <div className="rounded-md border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-950">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-yellow-900 dark:text-yellow-100">
                    Status Unknown
                  </p>
                  <p className="mt-1 text-sm text-yellow-800 dark:text-yellow-200">
                    The transaction status could not be determined within the timeout period. The transaction may have succeeded or failed, but we were unable to confirm its final state.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Total Duration */}
          {totalDuration && (
            <div className="text-xs text-muted-foreground">
              Total duration: {totalDuration}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

