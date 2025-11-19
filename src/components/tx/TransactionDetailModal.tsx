import { useEffect, useState, useCallback } from 'react'
import { X, CheckCircle2, XCircle, Clock, AlertCircle, Copy, ExternalLink } from 'lucide-react'
import type { StoredTransaction } from '@/services/tx/transactionStorageService'
import {
  isInProgress,
  isSuccess,
  isError,
  getStatusLabel,
  getTotalDurationLabel,
  getProgressPercentage,
  getStageTimings,
  getCurrentStage,
  hasClientTimeout,
} from '@/services/tx/transactionStatusService'
import { cn } from '@/lib/utils'
import { fetchEvmChainsConfig } from '@/services/config/chainConfigService'
import { fetchTendermintChainsConfig } from '@/services/config/tendermintChainConfigService'
import type { EvmChainsFile, TendermintChainsFile } from '@/config/chains'
import { findChainByKey } from '@/config/chains'
import { findTendermintChainByKey, getDefaultNamadaChainKey } from '@/config/chains'
import { useToast } from '@/hooks/useToast'

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
      notify({
        title: 'Copied',
        description: `${label} copied to clipboard`,
        level: 'success',
      })
    } catch (error) {
      console.error('[TransactionDetailModal] Failed to copy to clipboard:', error)
      notify({
        title: 'Copy Failed',
        description: 'Failed to copy to clipboard',
        level: 'error',
      })
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
    return chainKey.toUpperCase()
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
        if (chain?.explorer?.baseUrl && chain.explorer.addressPath) {
          return `${chain.explorer.baseUrl}/${chain.explorer.addressPath}/${value}`
        }
      } else if (chainType === 'namada') {
        const namadaChainKey = tendermintChainsConfig ? getDefaultNamadaChainKey(tendermintChainsConfig) : 'namada-testnet'
        const chain = tendermintChainsConfig ? findTendermintChainByKey(tendermintChainsConfig, namadaChainKey || 'namada-testnet') : null
        if (chain?.explorer?.baseUrl) {
          // Namada explorer typically uses /account/{address} or similar
          return `${chain.explorer.baseUrl}/account/${value}`
        }
      } else if (chainType === 'noble') {
        const chain = tendermintChainsConfig ? findTendermintChainByKey(tendermintChainsConfig, 'noble-testnet') : null
        if (chain?.explorer?.baseUrl) {
          return `${chain.explorer.baseUrl}/account/${value}`
        }
      }
    } else if (type === 'tx') {
      if (chainType === 'evm') {
        const chain = chainKey && evmChainsConfig ? findChainByKey(evmChainsConfig, chainKey) : null
        if (chain?.explorer?.baseUrl && chain.explorer.txPath) {
          return `${chain.explorer.baseUrl}/${chain.explorer.txPath}/${value}`
        }
      } else if (chainType === 'namada') {
        const namadaChainKey = tendermintChainsConfig ? getDefaultNamadaChainKey(tendermintChainsConfig) : 'namada-testnet'
        const chain = tendermintChainsConfig ? findTendermintChainByKey(tendermintChainsConfig, namadaChainKey || 'namada-testnet') : null
        if (chain?.explorer?.baseUrl) {
          return `${chain.explorer.baseUrl}/tx/${value}`
        }
      } else if (chainType === 'noble') {
        const chain = tendermintChainsConfig ? findTendermintChainByKey(tendermintChainsConfig, 'noble-testnet') : null
        if (chain?.explorer?.baseUrl) {
          return `${chain.explorer.baseUrl}/tx/${value}`
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

  if (transaction.flowStatusSnapshot) {
    const { chainProgress } = transaction.flowStatusSnapshot
    if (transaction.direction === 'deposit') {
      // Deposits: Send Tx = evm, Receive Tx = namada
      sendTxHash = chainProgress.evm?.txHash || chainProgress.evm?.stages?.find(s => s.txHash)?.txHash
      receiveTxHash = chainProgress.namada?.txHash || chainProgress.namada?.stages?.find(s => s.txHash)?.txHash
    } else {
      // Payments: Send Tx = namada, Receive Tx = evm
      sendTxHash = chainProgress.namada?.txHash || chainProgress.namada?.stages?.find(s => s.txHash)?.txHash
      receiveTxHash = chainProgress.evm?.txHash || chainProgress.evm?.stages?.find(s => s.txHash)?.txHash
    }
  }

  // Fallback to transaction.hash if flowStatusSnapshot doesn't have the hashes
  if (!sendTxHash && transaction.hash) {
    sendTxHash = transaction.hash
  }

  // Status icon and color
  let statusIcon = <Clock className="h-5 w-5" />
  let statusColor = 'text-muted-foreground'

  if (isSuccess(transaction)) {
    statusIcon = <CheckCircle2 className="h-5 w-5" />
    statusColor = 'text-green-600'
  } else if (isError(transaction)) {
    statusIcon = <XCircle className="h-5 w-5" />
    statusColor = 'text-red-600'
  } else if (transaction.status === 'undetermined' || transaction.isFrontendOnly) {
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
              {senderAddress && (() => {
                const explorerUrl = buildExplorerUrl(
                  senderAddress,
                  'address',
                  transaction.direction === 'deposit' ? 'evm' : 'namada',
                  transaction.direction === 'deposit' 
                    ? getEvmChainKey(transaction.depositDetails?.chainName, transaction.chain)
                    : undefined
                )
                return (
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Sender Address</dt>
                    <dd className="mt-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm">{formatAddress(senderAddress)}</span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => copyToClipboard(senderAddress, 'Sender Address')}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                            aria-label="Copy Sender Address"
                            title="Copy Sender Address"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          {explorerUrl && (
                            <a
                              href={explorerUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                              aria-label="Open Sender Address in explorer"
                              title="Open Sender Address in explorer"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>
                      </div>
                    </dd>
                  </div>
                )
              })()}
              {receiverAddress && (() => {
                const explorerUrl = buildExplorerUrl(
                  receiverAddress,
                  'address',
                  transaction.direction === 'deposit' ? 'namada' : 'evm',
                  transaction.direction === 'send'
                    ? getEvmChainKey(transaction.paymentDetails?.chainName, transaction.chain)
                    : undefined
                )
                return (
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Receiver Address</dt>
                    <dd className="mt-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm">{formatAddress(receiverAddress)}</span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => copyToClipboard(receiverAddress, 'Receiver Address')}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                            aria-label="Copy Receiver Address"
                            title="Copy Receiver Address"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          {explorerUrl && (
                            <a
                              href={explorerUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                              aria-label="Open Receiver Address in explorer"
                              title="Open Receiver Address in explorer"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>
                      </div>
                    </dd>
                  </div>
                )
              })()}
              {sendTxHash && (() => {
                const explorerUrl = buildExplorerUrl(
                  sendTxHash,
                  'tx',
                  transaction.direction === 'deposit' ? 'evm' : 'namada',
                  transaction.direction === 'deposit'
                    ? getEvmChainKey(transaction.depositDetails?.chainName, transaction.chain)
                    : undefined
                )
                return (
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Send Tx</dt>
                    <dd className="mt-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm">{formatHash(sendTxHash)}</span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => copyToClipboard(sendTxHash, 'Send Tx')}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                            aria-label="Copy Send Tx"
                            title="Copy Send Tx"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          {explorerUrl && (
                            <a
                              href={explorerUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                              aria-label="Open Send Tx in explorer"
                              title="Open Send Tx in explorer"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>
                      </div>
                    </dd>
                  </div>
                )
              })()}
              {receiveTxHash && (() => {
                const explorerUrl = buildExplorerUrl(
                  receiveTxHash,
                  'tx',
                  transaction.direction === 'deposit' ? 'namada' : 'evm',
                  transaction.direction === 'send'
                    ? getEvmChainKey(transaction.paymentDetails?.chainName, transaction.chain)
                    : undefined
                )
                return (
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Receive Tx</dt>
                    <dd className="mt-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm">{formatHash(receiveTxHash)}</span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => copyToClipboard(receiveTxHash, 'Receive Tx')}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                            aria-label="Copy Receive Tx"
                            title="Copy Receive Tx"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          {explorerUrl && (
                            <a
                              href={explorerUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                              aria-label="Open Receive Tx in explorer"
                              title="Open Receive Tx in explorer"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>
                      </div>
                    </dd>
                  </div>
                )
              })()}
              {transaction.flowId && !transaction.isFrontendOnly && (
                <div className="col-span-2">
                  <dt className="text-muted-foreground">Flow ID</dt>
                  <dd className="mt-1 font-mono text-sm">{transaction.flowId}</dd>
                </div>
              )}
              {transaction.isFrontendOnly && (
                <div className="col-span-2">
                  <dt className="text-muted-foreground">Mode</dt>
                  <dd className="mt-1 text-sm font-medium text-yellow-600">Frontend Only</dd>
                </div>
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
          {(transaction.status === 'undetermined' || transaction.isFrontendOnly) && (
            <div className="rounded-md border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-950">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-yellow-900 dark:text-yellow-100">
                    {transaction.isFrontendOnly ? 'Frontend Only Mode' : 'Status Unknown'}
                  </p>
                  <p className="mt-1 text-sm text-yellow-800 dark:text-yellow-200">
                    {transaction.isFrontendOnly
                      ? 'This transaction was not submitted to the backend for tracking. Status cannot be determined as backend tracking is unavailable. The transaction may have succeeded or failed, but we cannot confirm its final state.'
                      : 'The transaction status could not be determined within the timeout period. The transaction may have succeeded or failed, but we were unable to confirm its final state.'}
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

