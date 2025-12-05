import { useEffect, useState, useCallback } from 'react'
import { X, CheckCircle2, XCircle, Clock, AlertCircle, Copy, ExternalLink, ChevronDown, ChevronRight } from 'lucide-react'
import type { StoredTransaction } from '@/services/tx/transactionStorageService'
import {
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
import { ResumePollingButton } from '@/components/polling/ResumePollingButton'
import { CancelPollingButton } from '@/components/polling/CancelPollingButton'
import { RetryPollingButton } from '@/components/polling/RetryPollingButton'
import { RegisterNobleForwardingButton } from '@/components/polling/RegisterNobleForwardingButton'
import { getAllChainStatuses } from '@/services/polling/pollingStatusUtils'
import { getChainOrder } from '@/shared/flowStages'
import type { ChainKey } from '@/shared/flowStages'
import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fetchEvmChainsConfig } from '@/services/config/chainConfigService'
import { fetchTendermintChainsConfig } from '@/services/config/tendermintChainConfigService'
import type { EvmChainsFile, TendermintChainsFile } from '@/config/chains'
import { findChainByKey } from '@/config/chains'
import { findTendermintChainByKey, getDefaultNamadaChainKey } from '@/config/chains'
import { useToast } from '@/hooks/useToast'
import { buildCopySuccessToast, buildCopyErrorToast } from '@/utils/toastHelpers'
import { CollapsibleError } from '@/components/common/CollapsibleError'

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
  const [expandedChains, setExpandedChains] = useState<Set<ChainKey>>(new Set())
  const [isStageTimelineExpanded, setIsStageTimelineExpanded] = useState(false)

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

  // Status icon
  let statusIcon = <Clock className="h-5 w-5" />

  const effectiveStatus = getEffectiveStatus(transaction)

  if (isSuccess(transaction)) {
    statusIcon = <CheckCircle2 className="h-5 w-5" />
  } else if (isError(transaction)) {
    statusIcon = <XCircle className="h-5 w-5" />
  } else if (effectiveStatus === 'user_action_required') {
    statusIcon = <AlertCircle className="h-5 w-5" />
  } else if (effectiveStatus === 'undetermined') {
    statusIcon = <AlertCircle className="h-5 w-5" />
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
      <div className="space-y-1">
        <dt className="text-sm text-muted-foreground">{label}</dt>
        <dd>
          <div className="flex justify-between gap-2">
            <span className="font-mono text-sm">{value}</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onCopy}
                className="p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
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
                  className="p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
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
      <div className="border border-border bg-muted/50 p-4">
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
      <div className="relative z-50 w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-lg border border-border bg-background shadow-lg">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between bg-background p-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold">
              {transaction.direction === 'deposit' ? 'Deposit' : 'Payment'} Details
            </h2>
            <p className="text-sm text-muted-foreground">
              {amount ? `${amount} USDC` : 'USDC'} · {route}
            </p>
            {totalDuration && (
              <p className="text-xs text-muted-foreground">
                Total duration: {totalDuration}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {/* Status Badge */}
            <div className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1',
              isSuccess(transaction) ? 'bg-green-100 dark:bg-green-900/30 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400' :
                isError(transaction) ? 'bg-red-100 dark:bg-red-900/30 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400' :
                  effectiveStatus === 'user_action_required' ? 'bg-orange-100 dark:bg-orange-900/30 border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-400' :
                    effectiveStatus === 'undetermined' ? 'bg-yellow-100 dark:bg-yellow-900/30 border-yellow-200 dark:border-yellow-800 text-yellow-700 dark:text-yellow-400' :
                      'bg-muted border-muted text-muted-foreground'
            )}>
              {statusIcon}
              <span className="text-xs font-medium">{statusLabel}</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1 text-muted-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label="Close modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 pt-2 space-y-6">
          {/* Transaction Summary */}
          <div className="text-sm border border-slate-200 p-6 rounded-md bg-slate-200/50">
            <div className="flex flex-wrap justify-around items-center gap-x-6 gap-y-2">
              {amount && (
                <div>
                  <span className="text-muted-foreground">Amount: </span>
                  <span className="font-medium">{amount} USDC</span>
                </div>
              )}
              <div>
                <span className="text-muted-foreground">Source: </span>
                <span className="font-medium">
                  {transaction.direction === 'deposit'
                    ? (transaction.depositDetails?.chainName || transaction.chain || 'EVM')
                    : 'Namada'}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Started At: </span>
                <span className="font-medium">{startedAt}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Status: </span>
                <span className="text-muted-foreground">{statusLabel}</span>
              </div>
              {/* Current Stage Indicator */}
              {currentStage && (
                <div className="flex items-center w-full gap-2 justify-between mt-4">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">
                      <span className="mr-1">Latest Stage:</span><span className="capitalize font-bold">{currentStage.stage.replace(/_/g, ' ')}</span> on {getChainDisplayName(currentStage.chain)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm gap-2">
                    <span className="text-muted-foreground">Overall Progress</span>
                    <span className="font-medium">{progress}%</span>
                  </div>
                </div>
              )}
              {/* Progress Bar */}
              <div className="space-y-2 min-w-full">
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Two-Column Layout: Transaction Details and Chain Status */}
          <div className="grid grid-cols-2 gap-6">
            {/* Left Column: Transaction Details */}
            <div className="space-y-4 border border-slate-200 p-6 rounded-md">
              <h3 className="text-sm font-semibold">Transaction Details</h3>
              <div className="space-y-4">
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

            {/* Right Column: Chain Status */}
            <div className="space-y-4 border border-slate-200 p-6 rounded-md">
              <h3 className="text-sm font-semibold">Chain Status</h3>
              {transaction.pollingState ? (() => {
                const flowType = transaction.direction === 'deposit' ? 'deposit' : 'payment'
                const chainOrder = getChainOrder(flowType)
                const chainStatuses = getAllChainStatuses(transaction)

                // Chain display names
                const chainNames: Record<ChainKey, string> = {
                  evm: transaction.direction === 'deposit'
                    ? (transaction.depositDetails?.chainName || transaction.chain || 'EVM')
                    : (transaction.paymentDetails?.chainName || transaction.chain || 'EVM'),
                  noble: 'Noble',
                  namada: 'Namada',
                }

                const toggleChainExpanded = (chain: ChainKey) => {
                  setExpandedChains((prev) => {
                    const next = new Set(prev)
                    if (next.has(chain)) {
                      next.delete(chain)
                    } else {
                      next.add(chain)
                    }
                    return next
                  })
                }

                return (
                  <div className="space-y-4">
                    {chainOrder.map((chain, index) => {
                      const chainStatus = chainStatuses[chain]
                      const isSuccess = chainStatus?.status === 'success'
                      const completedStages = chainStatus?.completedStages || []
                      const isLast = index === chainOrder.length - 1
                      const isExpanded = expandedChains.has(chain)

                      return (
                        <div key={chain} className="relative space-y-1">
                          {/* Vertical line connecting chains */}
                          {!isLast && (
                            <div className="absolute left-[9px] top-[24px] bottom-[-12px] w-[2px] bg-border min-h-[36px]" />
                          )}

                          <div className="flex justify-between items-center gap-2 pl-6">
                            <div className="flex gap-2 items-center">
                              <div className="absolute left-0 flex items-center justify-center">
                                {isSuccess ? (
                                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                                ) : chainStatus?.status === 'tx_error' || chainStatus?.status === 'polling_error' ? (
                                  <XCircle className="h-5 w-5 text-red-600" />
                                ) : chainStatus?.status === 'polling_timeout' ? (
                                  <Clock className="h-5 w-5 text-yellow-600" />
                                ) : (
                                  <Clock className="h-5 w-5 text-muted-foreground" />
                                )}
                              </div>
                              <span className="text-sm font-medium">{chainNames[chain]}</span>
                            </div>
                            <div className="flex gap-2 items-center">
                              {isSuccess && (
                                <span className="inline-flex items-center rounded-full border border-green-200 dark:border-green-800 bg-green-100 dark:bg-green-900/30 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
                                  Success
                                </span>
                              )}
                              {completedStages.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => toggleChainExpanded(chain)}
                                  className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                                  aria-label={isExpanded ? 'Hide completed stages' : 'Show completed stages'}
                                  title={isExpanded ? 'Hide completed stages' : 'Show completed stages'}
                                >
                                  <Info className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                          {completedStages.length > 0 && (
                            <>
                              {isExpanded ? (
                                <div className="text-xs text-muted-foreground pl-10">
                                  Completed: {completedStages.join(', ')}
                                </div>
                              ) : (
                                <div className="h-5" /> // Spacer when stages are hidden
                              )}
                            </>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })() : (
                <div className="text-sm text-muted-foreground">No polling state available</div>
              )}
            </div>
          </div>

          {/* Polling Control Buttons and Noble Forwarding Registration */}
          {transaction.pollingState && (
            <div className="space-y-4 -mt-2">
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
          )}

          {/* Error Message */}
          {transaction.errorMessage && (
            <CollapsibleError error={transaction.errorMessage} />
          )}

          {/* Client Timeout Notice */}
          {hasClientTimeout(transaction) && (
            <div className="border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-950">
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
            <div className="border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-950">
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

          {/* Bottom Section: Current Stage, Polling Status, and Retry Button */}
          {transaction.pollingState && (
            <div className="space-y-3 -mt-4">

              {/* Polling Status */}
              <div className="flex items-center justify-between">
                <div className="flex flex-col text-xs">
                  <span className="text-muted-foreground font-semibold">Polling Status</span>
                  {transaction.pollingState.lastUpdatedAt && (
                    <span className="text-muted-foreground">
                      Last updated: {new Date(transaction.pollingState.lastUpdatedAt).toLocaleString()}
                    </span>
                  )}

                </div>
                {transaction.pollingState.flowStatus === 'success' && (
                  <span className="inline-flex items-center rounded-full border border-green-200 dark:border-green-800 bg-green-100 dark:bg-green-900/30 px-4 py-2 text-xs font-medium text-green-700 dark:text-green-400">
                    Success
                  </span>
                )}
              </div>
              {/* Polling Control Buttons */}
              <div className="flex items-center gap-2">
                <RetryPollingButton transaction={transaction} size="sm" variant="default" />
                <ResumePollingButton transaction={transaction} size="sm" variant="default" />
                <CancelPollingButton transaction={transaction} size="sm" variant="outline" />
              </div>
            </div>
          )}

          {/* Stage Timeline */}
          {stageTimings.length > 0 && (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => setIsStageTimelineExpanded(!isStageTimelineExpanded)}
                className="flex items-center gap-2 text-sm font-semibold uppercase text-muted-foreground hover:text-foreground transition-colors"
              >
                {isStageTimelineExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                <span>Status Polling Details</span>
              </button>
              {isStageTimelineExpanded && (
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
                          <div className="absolute left-[11px] top-[24px] bottom-[-12px] w-[2px] bg-border min-h-[36px]" />
                        )}

                        {/* Stage content */}
                        <div className="flex items-start gap-3">
                          <div className="relative z-10 -ml-8 flex h-6 w-6 items-center justify-center">
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
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

