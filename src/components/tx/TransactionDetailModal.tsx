import { useEffect, useState, useCallback } from 'react'
import { X, CheckCircle2, XCircle, Clock, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { InfoRow } from '@/components/common/InfoRow'
import { ExplorerLink } from '@/components/common/ExplorerLink'
import { CopyButton } from '@/components/common/CopyButton'
import type { StoredTransaction } from '@/services/tx/transactionStorageService'
import {
  isSuccess,
  isError,
  getStatusLabel,
  getEffectiveStatus,
  getTotalDurationLabel,
  getStageTimings,
  hasClientTimeout,
} from '@/services/tx/transactionStatusService'
import { ResumePollingButton } from '@/components/polling/ResumePollingButton'
import { CancelPollingButton } from '@/components/polling/CancelPollingButton'
import { RetryPollingButton } from '@/components/polling/RetryPollingButton'
import { RegisterNobleForwardingButton } from '@/components/polling/RegisterNobleForwardingButton'
import type { ChainKey } from '@/shared/flowStages'
import { getAllStagesFromTransaction } from '@/services/polling/stageUtils'
import { cn } from '@/lib/utils'
import { fetchEvmChainsConfig } from '@/services/config/chainConfigService'
import { fetchTendermintChainsConfig } from '@/services/config/tendermintChainConfigService'
import type { EvmChainsFile, TendermintChainsFile } from '@/config/chains'
import { findChainByKey } from '@/config/chains'
import { findTendermintChainByKey, getDefaultNamadaChainKey } from '@/config/chains'
import { ChainProgressTimeline } from '@/components/tx/ChainProgressTimeline'
import { DEPOSIT_STAGES, getExpectedStages, getChainOrder, type FlowType } from '@/shared/flowStages'
import type { StageTiming } from '@/services/tx/transactionStatusService'

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
  const [evmChainsConfig, setEvmChainsConfig] = useState<EvmChainsFile | null>(null)
  const [tendermintChainsConfig, setTendermintChainsConfig] = useState<TendermintChainsFile | null>(null)
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

  // Helper to get EVM chain logo
  const getEvmChainLogo = useCallback((): string | undefined => {
    const chainKey = transaction.direction === 'deposit'
      ? getEvmChainKey(transaction.depositDetails?.chainName, transaction.chain)
      : getEvmChainKey(transaction.paymentDetails?.chainName, transaction.chain)
    
    if (chainKey && evmChainsConfig) {
      const chain = findChainByKey(evmChainsConfig, chainKey)
      return chain?.logo
    }
    return undefined
  }, [transaction, evmChainsConfig, getEvmChainKey])

  // Helper to get send transaction status
  const getSendTxStatus = useCallback((): 'success' | 'pending' => {
    if (!transaction.pollingState) return 'pending'
    const chainStatus = transaction.pollingState.chainStatus
    if (transaction.direction === 'deposit') {
      return chainStatus.evm?.status === 'success' ? 'success' : 'pending'
    } else {
      return chainStatus.namada?.status === 'success' ? 'success' : 'pending'
    }
  }, [transaction])

  // Helper to get receive transaction status
  const getReceiveTxStatus = useCallback((): 'success' | 'pending' => {
    if (!transaction.pollingState) return 'pending'
    const chainStatus = transaction.pollingState.chainStatus
    if (transaction.direction === 'deposit') {
      return chainStatus.namada?.status === 'success' ? 'success' : 'pending'
    } else {
      return chainStatus.evm?.status === 'success' ? 'success' : 'pending'
    }
  }, [transaction])

  // Helper to get source chain name (From)
  const getSourceChainName = useCallback((): string => {
    if (transaction.direction === 'deposit') {
      // For deposits, source is EVM chain
      const chainName = transaction.depositDetails?.chainName || transaction.chain
      if (chainName && evmChainsConfig) {
        const chain = evmChainsConfig.chains.find(
          c => c.name.toLowerCase() === chainName.toLowerCase() || c.key === chainName
        )
        if (chain) {
          return chain.name
        }
        return chainName
      }
      if (transaction.chain && evmChainsConfig) {
        const chain = findChainByKey(evmChainsConfig, transaction.chain)
        if (chain) {
          return chain.name
        }
      }
      return transaction.chain || 'EVM'
    } else {
      // For payments, source is Namada
      return 'Namada'
    }
  }, [transaction, evmChainsConfig])

  // Helper to get destination chain name (To)
  const getDestinationChainName = useCallback((): string => {
    if (transaction.direction === 'deposit') {
      // For deposits, destination is Namada
      return 'Namada'
    } else {
      // For payments, destination is EVM chain
      const chainName = transaction.paymentDetails?.chainName || transaction.chain
      if (chainName && evmChainsConfig) {
        const chain = evmChainsConfig.chains.find(
          c => c.name.toLowerCase() === chainName.toLowerCase() || c.key === chainName
        )
        if (chain) {
          return chain.name
        }
        return chainName
      }
      if (transaction.chain && evmChainsConfig) {
        const chain = findChainByKey(evmChainsConfig, transaction.chain)
        if (chain) {
          return chain.name
        }
      }
      return transaction.chain || 'EVM'
    }
  }, [transaction, evmChainsConfig])

  // Build explorer URL helper
  const buildExplorerUrl = useCallback((
    value: string,
    type: 'address' | 'tx' | 'block',
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
    } else if (type === 'block') {
      // Block explorer URLs
      if (chainType === 'evm') {
        const chain = chainKey && evmChainsConfig ? findChainByKey(evmChainsConfig, chainKey) : null
        if (chain?.explorer?.baseUrl) {
          const blockPath = chain.explorer.blockPath ?? 'block'
          return `${chain.explorer.baseUrl}/${blockPath}/${value}`
        }
      } else if (chainType === 'namada') {
        const namadaChainKey = tendermintChainsConfig ? getDefaultNamadaChainKey(tendermintChainsConfig) : 'namada-testnet'
        const chain = tendermintChainsConfig ? findTendermintChainByKey(tendermintChainsConfig, namadaChainKey || 'namada-testnet') : null
        if (chain?.explorer?.baseUrl) {
          const blockPath = chain.explorer.blockPath ?? 'blocks'
          return `${chain.explorer.baseUrl}/${blockPath}/${value}`
        }
      } else if (chainType === 'noble') {
        const chain = tendermintChainsConfig ? findTendermintChainByKey(tendermintChainsConfig, 'noble-testnet') : null
        if (chain?.explorer?.baseUrl) {
          const blockPath = chain.explorer.blockPath ?? 'blocks'
          return `${chain.explorer.baseUrl}/${blockPath}/${value}`
        }
      }
    }
    return undefined
  }, [evmChainsConfig, tendermintChainsConfig])

  if (!open) {
    return null
  }

  const flowType: FlowType = transaction.direction === 'deposit' ? 'deposit' : 'payment'
  const statusLabel = getStatusLabel(transaction)
  const totalDuration = getTotalDurationLabel(transaction)
  const actualStageTimings = getStageTimings(transaction, flowType)
  // Get full stages with metadata for block information
  const allStages = getAllStagesFromTransaction(transaction, flowType)
  
  // Merge expected stages with actual stages to show all expected stages
  const stageTimings: StageTiming[] = []
  const chainOrder = getChainOrder(flowType)
  const now = Date.now()
  
  // Get all expected stages for all chains
  const expectedStagesByChain: Record<string, string[]> = {}
  chainOrder.forEach(chain => {
    expectedStagesByChain[chain] = getExpectedStages(flowType, chain) as string[]
  })
  
  // Track which stages we've already added
  const addedStages = new Set<string>()
  
  // First, add all actual stages that have occurred
  actualStageTimings.forEach(timing => {
    const key = `${timing.chain}-${timing.stage}`
    if (!addedStages.has(key)) {
      stageTimings.push(timing)
      addedStages.add(key)
    }
  })
  
  // Then, add expected stages that haven't occurred yet
  chainOrder.forEach(chain => {
    const expectedStages = expectedStagesByChain[chain]
    expectedStages.forEach(stage => {
      const key = `${chain}-${stage}`
      if (!addedStages.has(key)) {
        // Find the last occurred stage timestamp to maintain order
        const lastOccurredAt = stageTimings.length > 0 
          ? Math.max(...stageTimings.map(s => s.occurredAt))
          : now
        
        stageTimings.push({
          stage,
          chain: chain as 'evm' | 'noble' | 'namada',
          status: 'pending',
          occurredAt: lastOccurredAt + 1, // Place after last occurred stage
        })
        addedStages.add(key)
      }
    })
  })
  
  // Sort by chain order first, then by stage order within chain
  stageTimings.sort((a, b) => {
    const aChainIndex = chainOrder.indexOf(a.chain)
    const bChainIndex = chainOrder.indexOf(b.chain)
    if (aChainIndex !== bChainIndex) {
      return aChainIndex - bChainIndex
    }
    // Within same chain, sort by expected stage order
    const aStageIndex = expectedStagesByChain[a.chain].indexOf(a.stage)
    const bStageIndex = expectedStagesByChain[b.chain].indexOf(b.stage)
    if (aStageIndex !== bStageIndex) {
      return aStageIndex - bStageIndex
    }
    // If same stage, sort by occurredAt
    return a.occurredAt - b.occurredAt
  })

  // Format started at timestamp
  const startedAt = new Date(transaction.createdAt).toLocaleString()

  // Get amount from transaction metadata
  let amount: string | undefined
  if (transaction.flowMetadata) {
    const amountInBase = transaction.flowMetadata.amount
    if (amountInBase) {
      const amountInUsdc = (parseInt(amountInBase) / 1_000_000).toFixed(2)
      amount = amountInUsdc
    }
  } else if (transaction.depositDetails) {
    amount = transaction.depositDetails.amount
  } else if (transaction.paymentDetails) {
    amount = transaction.paymentDetails.amount
  }


  // Get receiver address
  const receiverAddress = transaction.depositDetails?.destinationAddress || transaction.paymentDetails?.destinationAddress

  // Get sender address
  // For payments: sender is the Namada transparent address (from paymentData.disposableSignerAddress)
  // For deposits: sender is the EVM address (from depositDetails)
  let senderAddress: string | undefined
  if (transaction.direction === 'deposit') {
    senderAddress = transaction.depositDetails?.senderAddress
  } else if (transaction.direction === 'send') {
    // paymentData is not in the type definition but exists in runtime data
    const txWithPaymentData = transaction as StoredTransaction & { paymentData?: { disposableSignerAddress?: string } }
    senderAddress = txWithPaymentData.paymentData?.disposableSignerAddress ||
      transaction.flowMetadata?.shieldedMetadata?.transparentAddress
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-overlay backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Content */}
      <div className="relative z-50 w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-lg border border-border bg-background shadow-lg">
        {/* Header */}
        <div className="sticky top-0 z-20 flex items-center justify-between bg-background p-6">
          <div className="flex items-baseline justify-between flex-1 pr-4 gap-1">
            <div className="flex items-center gap-2">
              {/* For deposits: logo → arrow → "Deposit" */}
              {/* For payments: "Payment" → arrow → logo */}
              {transaction.direction === 'deposit' ? (
                <>
                  {getEvmChainLogo() && (
                    <img
                      src={getEvmChainLogo()}
                      alt={transaction.depositDetails?.chainName || transaction.chain || 'Source'}
                      className="h-6 w-6 rounded-full flex-shrink-0 object-contain"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none'
                      }}
                    />
                  )}
                  <div className="text-muted-foreground">
                    →
                  </div>
                  <h2 className="text-xl font-semibold">
                    Deposit
                  </h2>
                </>
              ) : (
                <>
                  <h2 className="text-xl font-semibold">
                    Payment
                  </h2>
                  <div className="text-muted-foreground">
                    →
                  </div>
                  {getEvmChainLogo() && (
                    <img
                      src={getEvmChainLogo()}
                      alt={transaction.paymentDetails?.chainName || transaction.chain || 'Destination'}
                      className="h-6 w-6 rounded-full flex-shrink-0 object-contain"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none'
                      }}
                    />
                  )}
                </>
              )}
            </div>
            <p className="text-xs text-muted-foreground self-center">
              Sent {startedAt}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Status Badge */}
            <div className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1',
              isSuccess(transaction) ? 'bg-success/10 text-success' :
                isError(transaction) ? 'bg-error/10 text-error' :
                  effectiveStatus === 'user_action_required' ? 'bg-warning/10 text-warning' :
                    effectiveStatus === 'undetermined' ? 'bg-warning/10 text-warning' :
                      'bg-muted text-muted-foreground'
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
          {/* First Row: Sender, Receiver, Amount, Duration */}
          <div className="grid grid-cols-4 gap-4">
            {senderAddress && (
              <div className="bg-muted p-4 rounded-md">
                <InfoRow
                  label={`From ${getSourceChainName()}`}
                  value={formatAddress(senderAddress)}
                  explorerUrl={buildExplorerUrl(
                    senderAddress,
                    'address',
                    transaction.direction === 'deposit' ? 'evm' : 'namada',
                    transaction.direction === 'deposit'
                      ? getEvmChainKey(transaction.depositDetails?.chainName, transaction.chain)
                      : undefined
                  )}
                  size="md"
                />
              </div>
            )}
            {receiverAddress && (
              <div className="bg-muted p-4 rounded-md">
                <InfoRow
                  label={`To ${getDestinationChainName()}`}
                  value={formatAddress(receiverAddress)}
                  explorerUrl={buildExplorerUrl(
                    receiverAddress,
                    'address',
                    transaction.direction === 'deposit' ? 'namada' : 'evm',
                    transaction.direction === 'send'
                      ? getEvmChainKey(transaction.paymentDetails?.chainName, transaction.chain)
                      : undefined
                  )}
                  size="md"
                />
              </div>
            )}
            {amount && (
              <div className="bg-muted p-4 rounded-md">
                <div className="space-y-1">
                  <dt className="text-sm text-muted-foreground">Amount</dt>
                  <dd>
                    <div className="flex items-center gap-2">
                      <img
                        src="/assets/logos/usdc-logo.svg"
                        alt="USDC"
                        className="h-5 w-5 flex-shrink-0"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none'
                        }}
                      />
                      <span className="text-md font-medium">{amount} USDC</span>
                    </div>
                  </dd>
                </div>
              </div>
            )}
            {totalDuration && (
              <div className="bg-muted p-4 rounded-md">
                <div className="space-y-1">
                  <dt className="text-sm capitalize text-muted-foreground">{transaction.direction} Duration</dt>
                  <dd>
                    <div className="flex items-center gap-2">
                      <Clock className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                      <span className="text-md font-medium">{totalDuration}</span>
                    </div>
                  </dd>
                </div>
              </div>
            )}
          </div>

          {/* Chain Progress Timeline */}
          {(transaction.pollingState || transaction.errorMessage) && (
            <div className="py-2 px-4">
              <ChainProgressTimeline
                transaction={transaction}
                evmChainsConfig={evmChainsConfig}
              />
            </div>
          )}

          {/* Source and Destination Transactions */}
          <div className="grid grid-cols-2 gap-4">
            {/* Source Transaction Card */}
            <div className="bg-muted p-4 rounded-md">
              <div className="space-y-3">
                <dt className="text-sm text-muted-foreground">Source Transaction</dt>
                <dd>
                  <div className="flex items-center gap-2">
                    {getSendTxStatus() === 'success' ? (
                      <CheckCircle2 className="h-5 w-5 text-success flex-shrink-0" />
                    ) : (
                      <Clock className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                    )}
                    {sendTxHash ? (
                      <>
                        <span className="text-sm font-mono">{formatHash(sendTxHash)}</span>
                        <div className="flex items-center gap-1">
                          <CopyButton
                            text={sendTxHash}
                            label="Source Transaction"
                            size="md"
                          />
                          {buildExplorerUrl(
                            sendTxHash,
                            'tx',
                            transaction.direction === 'deposit' ? 'evm' : 'namada',
                            transaction.direction === 'deposit'
                              ? getEvmChainKey(transaction.depositDetails?.chainName, transaction.chain)
                              : undefined
                          ) && (
                            <ExplorerLink
                              url={buildExplorerUrl(
                                sendTxHash,
                                'tx',
                                transaction.direction === 'deposit' ? 'evm' : 'namada',
                                transaction.direction === 'deposit'
                                  ? getEvmChainKey(transaction.depositDetails?.chainName, transaction.chain)
                                  : undefined
                              )!}
                              label="Open Source Transaction in explorer"
                              size="md"
                              iconOnly
                              className="explorer-link-inline"
                            />
                          )}
                        </div>
                      </>
                    ) : (
                      <span className="text-sm">Pending...</span>
                    )}
                  </div>
                </dd>
              </div>
            </div>

            {/* Destination Transaction Card */}
            <div className="bg-muted p-4 rounded-md">
              <div className="space-y-3">
                <dt className="text-sm text-muted-foreground">Destination Transaction</dt>
                <dd>
                  <div className="flex items-center gap-2">
                    {getReceiveTxStatus() === 'success' ? (
                      <CheckCircle2 className="h-5 w-5 text-success flex-shrink-0" />
                    ) : (
                      <Clock className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                    )}
                    {receiveTxHash ? (
                      <>
                        <span className="text-sm font-mono">{formatHash(receiveTxHash)}</span>
                        <div className="flex items-center gap-1">
                          <CopyButton
                            text={receiveTxHash}
                            label="Destination Transaction"
                            size="md"
                          />
                          {buildExplorerUrl(
                            receiveTxHash,
                            'tx',
                            transaction.direction === 'deposit' ? 'namada' : 'evm',
                            transaction.direction === 'send'
                              ? getEvmChainKey(transaction.paymentDetails?.chainName, transaction.chain)
                              : undefined
                          ) && (
                            <ExplorerLink
                              url={buildExplorerUrl(
                                receiveTxHash,
                                'tx',
                                transaction.direction === 'deposit' ? 'namada' : 'evm',
                                transaction.direction === 'send'
                                  ? getEvmChainKey(transaction.paymentDetails?.chainName, transaction.chain)
                                  : undefined
                              )!}
                              label="Open Destination Transaction in explorer"
                              size="md"
                              iconOnly
                              className="explorer-link-inline"
                            />
                          )}
                        </div>
                      </>
                    ) : (
                      <span className="text-sm">Pending...</span>
                    )}
                  </div>
                </dd>
              </div>
            </div>
          </div>

          {/* Tracking Control Buttons and Noble Forwarding Registration */}
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

          {/* Client Timeout Notice */}
          {hasClientTimeout(transaction) && (
            <div className="border border-warning/30 bg-warning/10 p-4">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-5 w-5 text-warning flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-warning-foreground">
                    Client-Side Tracking Stopped
                  </p>
                  <p className="mt-1 text-sm text-warning/90">
                    Client-side tracking stopped at{' '}
                    {transaction.clientTimeoutAt
                      ? new Date(transaction.clientTimeoutAt).toLocaleString()
                      : 'unknown time'}
                    . The backend is still tracking this transaction. Tracking will resume automatically
                    when you refresh the page.
                  </p>
                </div>
              </div>
            </div>
          )}


          {/* Bottom Section: Tracking Control Buttons */}
          {/* NOTE: Tracking control buttons are hidden but kept for debug purposes.
              They can be re-enabled by uncommenting the section below.
              The Retry button is now available in the status box for polling errors/timeouts. */}
          {false && transaction.pollingState && (
            <div className="space-y-3 -mt-4">
              {/* Tracking Control Buttons */}
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
                className="flex w-full bg-muted rounded-md justify-between p-3 items-center gap-2 text-md text-foreground hover:text-foreground transition-colors"
              >
                <span>Event Log</span>
                {isStageTimelineExpanded ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>
              {isStageTimelineExpanded && (
                <div className="space-y-3">
                  {/* Tracking Status */}
                  {transaction.pollingState && (
                    <div className="flex items-center justify-start gap-4 pb-3 border-b border-border">
                      <div className="flex flex-col text-xs">
                        <span className="text-muted-foreground font-semibold">Tracking Status</span>
                        {transaction.pollingState.lastUpdatedAt && (
                          <span className="text-muted-foreground">
                            Last updated: {new Date(transaction.pollingState.lastUpdatedAt).toLocaleString()}
                          </span>
                        )}
                      </div>
                      {transaction.pollingState.flowStatus === 'success' && (
                        <span className="inline-flex items-center rounded-full bg-success/10 px-2 py-1 text-xs font-medium text-success">
                          Success
                        </span>
                      )}
                      {transaction.pollingState.flowStatus === 'cancelled' && (
                        <span className="inline-flex items-center rounded-full bg-muted/50 px-2 py-1 text-xs font-medium text-muted-foreground">
                          Tracking Cancelled
                        </span>
                      )}
                    </div>
                  )}
                  {stageTimings.map((timing, index) => {
                    const isLast = index === stageTimings.length - 1
                    const timingIcon =
                      timing.status === 'confirmed' ? (
                        <CheckCircle2 className="h-4 w-4 text-success" />
                      ) : timing.status === 'failed' ? (
                        <XCircle className="h-4 w-4 text-error" />
                      ) : (
                        <Clock className="h-4 w-4 text-muted-foreground" />
                      )

                    // Find matching stage with metadata
                    // Match by stage name, occurredAt timestamp, and chain
                    const stageWithMetadata = allStages.find(
                      (s) => {
                        const stageOccurredAt = s.occurredAt ? new Date(s.occurredAt).getTime() : null
                        const stageChain = (s.metadata?.chain as ChainKey) || timing.chain
                        return s.stage === timing.stage &&
                          stageOccurredAt === timing.occurredAt &&
                          stageChain === timing.chain
                      }
                    )
                    const blockMetadata = stageWithMetadata?.metadata as {
                      blockHeight?: number | string
                      blockTimestamp?: number
                      eventTxHash?: string
                    } | undefined

                    // Get chain key for explorer URLs
                    const chainKey = timing.chain === 'evm'
                      ? (transaction.direction === 'deposit'
                        ? transaction.depositDetails?.chainName?.toLowerCase().replace(/\s+/g, '-') || transaction.chain
                        : transaction.pollingState?.metadata?.chainKey as string | undefined || transaction.chain)
                      : undefined

                    // Get transaction hash from stage.txHash (direct) or metadata.eventTxHash (from block metadata)
                    const txHash = stageWithMetadata?.txHash || blockMetadata?.eventTxHash

                    // Build explorer URLs
                    const txExplorerUrl = txHash
                      ? buildExplorerUrl(txHash, 'tx', timing.chain, chainKey)
                      : undefined
                    const blockExplorerUrl = blockMetadata?.blockHeight
                      ? buildExplorerUrl(String(blockMetadata.blockHeight), 'block', timing.chain, chainKey)
                      : undefined

                    // Format block timestamp if available
                    const blockTimestampStr = blockMetadata?.blockTimestamp
                      ? new Date(blockMetadata.blockTimestamp * 1000).toLocaleString()
                      : undefined

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
                            {timing.status === 'pending' ? (
                              <p className="text-xs text-muted-foreground">
                                Not completed
                              </p>
                            ) : timing.occurredAt ? (
                              <p className="text-xs text-muted-foreground">
                                Detected: {new Date(timing.occurredAt).toLocaleString()}
                              </p>
                            ) : null}
                            {/* Transaction hash (show even if no block metadata) */}
                            {txHash && (
                              <p className="text-xs text-muted-foreground flex items-center gap-1">
                                Transaction:{' '}
                                {txExplorerUrl ? (
                                  <ExplorerLink
                                    url={txExplorerUrl}
                                    size="sm"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <span className="font-mono">
                                      {txHash.slice(0, 10)}...{txHash.slice(-8)}
                                    </span>
                                  </ExplorerLink>
                                ) : (
                                  <span className="font-mono">
                                    {txHash.slice(0, 10)}...{txHash.slice(-8)}
                                  </span>
                                )}
                              </p>
                            )}
                            {/* Block metadata */}
                            {blockMetadata && (
                              <div className="space-y-1 text-xs text-muted-foreground">
                                {blockTimestampStr && (
                                  <p>
                                    Block time: {blockTimestampStr}
                                  </p>
                                )}
                                {blockMetadata.blockHeight && (
                                  <p className="flex items-center gap-1">
                                    Block height:{' '}
                                    {blockExplorerUrl ? (
                                      <ExplorerLink
                                        url={blockExplorerUrl}
                                        size="sm"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        {blockMetadata.blockHeight}
                                      </ExplorerLink>
                                    ) : (
                                      <span>{blockMetadata.blockHeight}</span>
                                    )}
                                  </p>
                                )}
                              </div>
                            )}
                            {/* Noble forwarding address for NOBLE_FORWARDING_REGISTRATION stage */}
                            {timing.stage === DEPOSIT_STAGES.NOBLE_FORWARDING_REGISTRATION && (
                              (() => {
                                const forwardingAddress = transaction.pollingState?.metadata?.forwardingAddress as string | undefined
                                const forwardingExplorerUrl = forwardingAddress
                                  ? buildExplorerUrl(forwardingAddress, 'address', 'noble')
                                  : undefined
                                return forwardingAddress ? (
                                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                                    Forwarding address:{' '}
                                    {forwardingExplorerUrl ? (
                                      <ExplorerLink
                                        url={forwardingExplorerUrl}
                                        size="sm"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <span className="font-mono">
                                          {forwardingAddress.slice(0, 10)}...{forwardingAddress.slice(-8)}
                                        </span>
                                      </ExplorerLink>
                                    ) : (
                                      <span className="font-mono">
                                        {forwardingAddress.slice(0, 10)}...{forwardingAddress.slice(-8)}
                                      </span>
                                    )}
                                  </p>
                                ) : null
                              })()
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

