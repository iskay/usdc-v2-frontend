import { useEffect, useState } from 'react'
import { Button } from '@/components/common/Button'
import { useTxTracker } from '@/hooks/useTxTracker'
import type { FlowStatus, UIStage } from '@/types/flow'
import { flowStorageService } from '@/services/flow/flowStorageService'
import { flowStatusCacheService } from '@/services/flow/flowStatusCacheService'
import { getFlowStatus } from '@/services/api/backendClient'
import {
  mapFlowStatusToUIStages,
  getFlowProgress,
  getEstimatedTimeRemaining,
  getCurrentActiveStage,
} from '@/services/flow/flowStatusMapper'
import { Check, Clock, X, ExternalLink } from 'lucide-react'

export function TxStatusCard() {
  const { state, clearActive, refreshFlowStatus } = useTxTracker()
  const tx = state.activeTransaction
  const [flowStatus, setFlowStatus] = useState<FlowStatus | null>(null)
  const [uiStages, setUIStages] = useState<UIStage[]>([])

  // Load flow status when transaction has flowId
  useEffect(() => {
    if (!tx?.flowId) {
      setFlowStatus(null)
      setUIStages([])
      return
    }

    const loadStatus = async () => {
      try {
        // Try cache first
        let status = flowStatusCacheService.getCachedFlowStatus(tx.flowId)
        
        // If not cached or stale, fetch from backend
        if (!status || Date.now() - status.lastUpdated > 30000) {
          status = await getFlowStatus(tx.flowId)
          flowStatusCacheService.cacheFlowStatus(tx.flowId, status)
        }

        setFlowStatus(status)

        // Get flow initiation metadata for flow type
        const flowInitiation = flowStorageService.getFlowInitiationByFlowId(tx.flowId)
        const flowType = flowInitiation?.flowType || (tx.direction === 'deposit' ? 'deposit' : 'payment')
        
        const stages = mapFlowStatusToUIStages(status, flowInitiation, flowType)
        setUIStages(stages)
      } catch (error) {
        console.warn('[TxStatusCard] Failed to load flow status', error)
      }
    }

    loadStatus()
    
    // Refresh periodically
    const interval = setInterval(loadStatus, 5000)
    return () => clearInterval(interval)
  }, [tx?.flowId, refreshFlowStatus])

  if (!tx) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <p className="text-sm text-muted-foreground">No active transactions.</p>
      </div>
    )
  }

  const flowType = tx.direction === 'deposit' ? 'deposit' : 'payment'
  const progress = flowStatus ? getFlowProgress(flowStatus, flowType) : 0
  const estimatedTime = flowStatus ? getEstimatedTimeRemaining(flowStatus, flowType) : '3'
  const currentStage = flowStatus ? getCurrentActiveStage(flowStatus, flowType) : null

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4 shadow-sm">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase text-muted-foreground">Active Transaction</p>
          <h3 className="text-lg font-semibold">{tx.direction === 'deposit' ? 'Deposit' : 'Payment'} flow</h3>
        </div>
        <Button variant="ghost" onClick={clearActive}>
          Clear
        </Button>
      </header>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-muted-foreground">Chain</dt>
          <dd className="font-medium">{tx.chain}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Status</dt>
          <dd className="font-medium capitalize">{tx.status.replace('-', ' ')}</dd>
        </div>
      </dl>

      {/* Progress Bar */}
      {flowStatus && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
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
        <div className="rounded-md bg-muted/50 p-2 text-sm">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium capitalize">{currentStage.stage.replace(/_/g, ' ')}</span>
            <span className="text-muted-foreground">on {currentStage.chain.toUpperCase()}</span>
          </div>
          {currentStage.message && (
            <p className="mt-1 text-xs text-muted-foreground">{currentStage.message}</p>
          )}
          {currentStage.txHash && (
            <a
              href={`#`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 flex items-center gap-1 text-xs text-primary hover:underline"
            >
              View on Explorer
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}

      {/* Estimated Time */}
      {flowStatus && flowStatus.status === 'pending' && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>Estimated time remaining: ~{estimatedTime} minutes</span>
        </div>
      )}

      {/* Multi-Chain Progress Timeline */}
      {uiStages.length > 0 && (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-xs font-medium uppercase text-muted-foreground">Progress Timeline</p>
          <div className="space-y-1">
            {uiStages.map((stage, index) => (
              <div
                key={`${stage.chain}-${stage.stage}-${index}`}
                className="flex items-center gap-2 text-xs"
              >
                {stage.status === 'confirmed' ? (
                  <Check className="h-3 w-3 text-green-600" />
                ) : stage.status === 'failed' ? (
                  <X className="h-3 w-3 text-red-600" />
                ) : (
                  <Clock className="h-3 w-3 text-muted-foreground" />
                )}
                <span className="capitalize">{stage.stage.replace(/_/g, ' ')}</span>
                <span className="text-muted-foreground">({stage.chain})</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
