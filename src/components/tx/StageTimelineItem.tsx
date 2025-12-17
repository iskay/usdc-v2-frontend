import { CheckCircle2, XCircle, Clock } from 'lucide-react'
import { ExplorerLink } from '@/components/common/ExplorerLink'
import type { StoredTransaction } from '@/services/tx/transactionStorageService'
import type { StageTiming } from '@/services/tx/transactionStatusService'
import type { ChainStage } from '@/types/flow'
import { DEPOSIT_STAGES } from '@/shared/flowStages'
import type { EvmChainsFile, TendermintChainsFile } from '@/config/chains'
import { buildExplorerUrlSync } from '@/utils/explorerUtils'
import { getChainDisplayName } from '@/utils/chainUtils'

export interface StageTimelineItemProps {
  timing: StageTiming
  stageWithMetadata: ChainStage | undefined
  chainKey: string | undefined
  transaction: StoredTransaction
  evmChainsConfig: EvmChainsFile | null
  tendermintChainsConfig: TendermintChainsFile | null
  isLast: boolean
}

export function StageTimelineItem({
  timing,
  stageWithMetadata,
  chainKey,
  transaction,
  evmChainsConfig,
  tendermintChainsConfig,
  isLast,
}: StageTimelineItemProps) {
  const timingIcon =
    timing.status === 'confirmed' ? (
      <CheckCircle2 className="h-4 w-4 text-success" />
    ) : timing.status === 'failed' ? (
      <XCircle className="h-4 w-4 text-error" />
    ) : (
      <Clock className="h-4 w-4 text-muted-foreground" />
    )

  const blockMetadata = stageWithMetadata?.metadata as {
    blockHeight?: number | string
    blockTimestamp?: number
    eventTxHash?: string
  } | undefined

  // Get transaction hash from stage.txHash (direct) or metadata.eventTxHash (from block metadata)
  const txHash = stageWithMetadata?.txHash || blockMetadata?.eventTxHash

  // Build explorer URLs
  const txExplorerUrl = txHash
    ? buildExplorerUrlSync(txHash, 'tx', timing.chain, chainKey, evmChainsConfig, tendermintChainsConfig)
    : undefined
  const blockExplorerUrl = blockMetadata?.blockHeight
    ? buildExplorerUrlSync(String(blockMetadata.blockHeight), 'block', timing.chain, chainKey, evmChainsConfig, tendermintChainsConfig)
    : undefined

  // Format block timestamp if available
  const blockTimestampStr = blockMetadata?.blockTimestamp
    ? new Date(blockMetadata.blockTimestamp * 1000).toLocaleString()
    : undefined

  // Get chain display name
  const chainDisplayName = getChainDisplayName(timing.chain, transaction, evmChainsConfig)

  return (
    <div className="relative pl-8">
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
              ({chainDisplayName})
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
                ? buildExplorerUrlSync(forwardingAddress, 'address', 'noble', undefined, evmChainsConfig, tendermintChainsConfig)
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
}

