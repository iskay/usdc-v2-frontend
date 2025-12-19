import { useEffect, useState } from 'react'
import { Clock, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react'
import type { StoredTransaction } from '@/services/tx/transactionStorageService'
import {
  getStatusLabel,
  getTotalDurationLabel,
  getStageTimings,
  hasClientTimeout,
} from '@/services/tx/transactionStatusService'
import type { ChainKey } from '@/shared/flowStages'
import { getAllStagesFromTransaction } from '@/services/polling/stageUtils'
import { fetchEvmChainsConfig } from '@/services/config/chainConfigService'
import { fetchTendermintChainsConfig } from '@/services/config/tendermintChainConfigService'
import type { EvmChainsFile, TendermintChainsFile } from '@/config/chains'
import { ChainProgressTimeline } from '@/components/tx/ChainProgressTimeline'
import { getExpectedStages, getChainOrder, type FlowType } from '@/shared/flowStages'
import type { StageTiming } from '@/services/tx/transactionStatusService'
import { TransactionDetailModalHeader } from './TransactionDetailModalHeader'
import { AddressDisplaySection } from './AddressDisplaySection'
import { TransactionHashCard } from './TransactionHashCard'
import { StageTimelineItem } from './StageTimelineItem'
import { getEvmChainKey, getSourceChainName, getDestinationChainName } from '@/utils/chainUtils'
import { buildExplorerUrlSync } from '@/utils/explorerUtils'
import { extractSendTxHash, extractReceiveTxHash, getSendTxStatus, getReceiveTxStatus, extractTransactionAmount } from '@/utils/transactionUtils'

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
  const [showSenderAddress, setShowSenderAddress] = useState(false)
  const [showReceiverAddress, setShowReceiverAddress] = useState(false)

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

  // Extract amount using utility function (returns with "USDC" suffix, but modal needs without)
  const amountWithSuffix = extractTransactionAmount(transaction)
  const amount = amountWithSuffix?.replace(' USDC', '')

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

  // Extract transaction hashes using utility functions
  const sendTxHash = extractSendTxHash(transaction)
  const receiveTxHash = extractReceiveTxHash(transaction)

  // Get transaction statuses
  const sendTxStatus = getSendTxStatus(transaction)
  const receiveTxStatus = getReceiveTxStatus(transaction)

  // Get chain names
  const sourceChainName = getSourceChainName(transaction, evmChainsConfig)
  const destinationChainName = getDestinationChainName(transaction, evmChainsConfig)

  // Helper to build explorer URLs
  const buildExplorerUrl = (
    value: string,
    type: 'address' | 'tx' | 'block',
    chainType: 'evm' | 'namada' | 'noble',
    chainKey?: string
  ): string | undefined => {
    return buildExplorerUrlSync(value, type, chainType, chainKey, evmChainsConfig, tendermintChainsConfig)
  }

  // Get EVM chain keys for explorer URLs
  const senderChainKey = transaction.direction === 'deposit'
    ? getEvmChainKey(transaction.depositDetails?.chainName, transaction.chain, evmChainsConfig)
    : undefined
  const receiverChainKey = transaction.direction === 'send'
    ? getEvmChainKey(transaction.paymentDetails?.chainName, transaction.chain, evmChainsConfig)
    : undefined

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
        <TransactionDetailModalHeader
          transaction={transaction}
          evmChainsConfig={evmChainsConfig}
          statusLabel={statusLabel}
          startedAt={startedAt}
          onClose={onClose}
        />

        {/* Content */}
        <div className="p-6 pt-2 space-y-6">
          {/* First Row: Sender, Receiver, Amount, Duration */}
          <div className="grid grid-cols-4 gap-4">
            {senderAddress && (
              <div className="bg-muted p-4 rounded-md">
                <AddressDisplaySection
                  address={senderAddress}
                  label={`From ${sourceChainName}`}
                  explorerUrl={buildExplorerUrl(
                    senderAddress,
                    'address',
                    transaction.direction === 'deposit' ? 'evm' : 'namada',
                    senderChainKey
                  )}
                  isSender={true}
                  showAddress={showSenderAddress}
                  onToggleShowAddress={() => setShowSenderAddress(!showSenderAddress)}
                  transaction={transaction}
                />
              </div>
            )}
            {receiverAddress && (
              <div className="bg-muted p-4 rounded-md">
                <AddressDisplaySection
                  address={receiverAddress}
                  label={`To ${destinationChainName}`}
                  explorerUrl={buildExplorerUrl(
                    receiverAddress,
                    'address',
                    transaction.direction === 'deposit' ? 'namada' : 'evm',
                    receiverChainKey
                  )}
                  isSender={false}
                  showAddress={showReceiverAddress}
                  onToggleShowAddress={() => setShowReceiverAddress(!showReceiverAddress)}
                  transaction={transaction}
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
            <TransactionHashCard
              label="Source Transaction"
              txHash={sendTxHash}
              status={sendTxStatus}
              explorerUrl={sendTxHash ? buildExplorerUrl(
                sendTxHash,
                'tx',
                transaction.direction === 'deposit' ? 'evm' : 'namada',
                senderChainKey
              ) : undefined}
            />
            <TransactionHashCard
              label="Destination Transaction"
              txHash={receiveTxHash}
              status={receiveTxStatus}
              explorerUrl={receiveTxHash ? buildExplorerUrl(
                receiveTxHash,
                'tx',
                transaction.direction === 'deposit' ? 'namada' : 'evm',
                receiverChainKey
              ) : undefined}
            />
          </div>


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

                    // Get chain key for explorer URLs
                    const chainKey = timing.chain === 'evm'
                      ? (transaction.direction === 'deposit'
                        ? transaction.depositDetails?.chainName?.toLowerCase().replace(/\s+/g, '-') || transaction.chain
                        : transaction.pollingState?.metadata?.chainKey as string | undefined || transaction.chain)
                      : undefined

                    return (
                      <StageTimelineItem
                        key={`${timing.chain}-${timing.stage}-${index}`}
                        timing={timing}
                        stageWithMetadata={stageWithMetadata}
                        chainKey={chainKey}
                        transaction={transaction}
                        evmChainsConfig={evmChainsConfig}
                        tendermintChainsConfig={tendermintChainsConfig}
                        isLast={isLast}
                      />
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

