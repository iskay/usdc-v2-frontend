/**
 * Transaction Status Service
 * 
 * Centralizes status determination logic and provides utilities for transaction display.
 * This service provides a single source of truth for transaction status checks and formatting.
 */

import type { StoredTransaction } from './transactionStorageService'
// import type { FlowStatus, ChainStage } from '@/types/flow'
// import { logger } from '@/utils/logger'
import { getChainOrder, getExpectedStages } from '@/shared/flowStages'
import { getAllStagesFromTransaction } from '@/services/polling/stageUtils'

/**
 * Get the effective status of a transaction.
 * 
 * This function treats `flowStatusSnapshot.status` as the authoritative source when available,
 * since it comes from the backend API. The top-level `status` field is used as a fallback
 * for cases where backend status isn't available (pre-backend registration, frontend-only transactions).
 * 
 * @param tx - Transaction to get effective status for
 * @returns Effective transaction status (from flowStatusSnapshot if available, else top-level status)
 */
export function getEffectiveStatus(tx: StoredTransaction): StoredTransaction['status'] {
  // Priority 1: flowStatusSnapshot (backend API) - most authoritative
  if (tx.flowStatusSnapshot?.status) {
    // Map backend flow status to transaction status
    const flowStatus = tx.flowStatusSnapshot.status
    if (flowStatus === 'completed') {
      return 'finalized'
    } else if (flowStatus === 'failed') {
      return 'error'
    } else if (flowStatus === 'undetermined') {
      return 'undetermined'
    } else if (flowStatus === 'pending') {
      // For pending flows, check if we have confirmed stages to determine if it's broadcasted
      const hasConfirmed =
        tx.flowStatusSnapshot.chainProgress.evm?.stages?.some((s) => s.status === 'confirmed') ||
        tx.flowStatusSnapshot.chainProgress.namada?.stages?.some((s) => s.status === 'confirmed')
      if (hasConfirmed) {
        return 'broadcasted'
      }
      return 'submitting'
    }
  }
  
  // Priority 2: pollingState.flowStatus (frontend polling) - for frontend-only transactions
  if (tx.pollingState?.flowStatus) {
    const flowStatus = tx.pollingState.flowStatus
    if (flowStatus === 'success') {
      return 'finalized'
    } else if (flowStatus === 'tx_error') {
      return 'error' // Transaction actually failed
    } else if (flowStatus === 'polling_error' || flowStatus === 'polling_timeout') {
      return 'undetermined' // Couldn't verify status - tx may have succeeded
    } else if (flowStatus === 'user_action_required') {
      return 'user_action_required' // User action required to continue
    } else if (flowStatus === 'cancelled') {
      // Cancelled - can be resumed, still in progress
      return 'broadcasted'
    }
    // flowStatus === 'pending' - fall through to check top-level status
  }
  
  // Priority 3: Top-level status (fallback)
  return tx.status
}

/**
 * Stage timing information extracted from flow status.
 */
export interface StageTiming {
  /** Stage identifier */
  stage: string
  /** Chain where stage occurred */
  chain: 'evm' | 'noble' | 'namada'
  /** Stage status */
  status: 'pending' | 'confirmed' | 'failed'
  /** Timestamp when stage occurred (milliseconds) */
  occurredAt: number
  /** Duration spent in this stage (milliseconds) */
  durationMs?: number
  /** Human-readable duration */
  durationLabel?: string
}

/**
 * Check if a transaction is in progress.
 * In-progress: status is not finalized, error, or undetermined.
 */
export function isInProgress(tx: StoredTransaction): boolean {
  const effectiveStatus = getEffectiveStatus(tx)
  
  // Check if effective status is in-progress
  const isInProgressStatus =
    effectiveStatus === 'submitting' ||
    effectiveStatus === 'broadcasted' ||
    effectiveStatus === 'user_action_required' ||
    effectiveStatus === 'building' ||
    effectiveStatus === 'signing' ||
    effectiveStatus === 'connecting-wallet'

  return isInProgressStatus
}

/**
 * Check if a transaction is completed (final state).
 * Completed: finalized, error, or undetermined.
 */
export function isCompleted(tx: StoredTransaction): boolean {
  const effectiveStatus = getEffectiveStatus(tx)
  return effectiveStatus === 'finalized' || effectiveStatus === 'error' || effectiveStatus === 'undetermined'
}

/**
 * Check if a transaction succeeded.
 */
export function isSuccess(tx: StoredTransaction): boolean {
  const effectiveStatus = getEffectiveStatus(tx)
  return effectiveStatus === 'finalized'
}

/**
 * Check if a transaction failed.
 */
export function isError(tx: StoredTransaction): boolean {
  const effectiveStatus = getEffectiveStatus(tx)
  return effectiveStatus === 'error'
}

/**
 * Check if a transaction has experienced a client-side polling timeout.
 * 
 * When client-side polling timeout occurs but backend is still tracking the transaction,
 * the `clientTimeoutAt` field is set. This function checks if that field exists.
 * 
 * @param tx - Transaction to check for client timeout
 * @returns `true` if transaction has `clientTimeoutAt` set, `false` otherwise
 */
export function hasClientTimeout(tx: StoredTransaction): boolean {
  return tx.clientTimeoutAt !== undefined && tx.clientTimeoutAt !== null
}

/**
 * Get human-readable status label for a transaction.
 */
export function getStatusLabel(tx: StoredTransaction): string {
  const effectiveStatus = getEffectiveStatus(tx)
  
  // Handle special statuses first
  if (effectiveStatus === 'undetermined') {
    return 'Status Unknown'
  }

  if (effectiveStatus === 'finalized') {
    return 'Completed'
  }

  if (effectiveStatus === 'error') {
    return 'Failed'
  }

  // Map status to label
  const statusLabels: Record<string, string> = {
    idle: 'Idle',
    'connecting-wallet': 'Connecting Wallet',
    building: 'Building Transaction',
    signing: 'Signing Transaction',
    submitting: 'Submitting',
    broadcasted: 'Broadcasted',
    user_action_required: 'User Action Required',
  }

  return statusLabels[effectiveStatus] || 'In Progress'
}

/**
 * Get timeout message for a transaction that has experienced client-side timeout.
 * 
 * Returns a user-friendly message explaining that client-side polling has stopped
 * but backend is still tracking the transaction.
 * 
 * @param tx - Transaction to get timeout message for
 * @returns Timeout message string, or `null` if transaction doesn't have timeout
 */
export function getTimeoutMessage(tx: StoredTransaction): string | null {
  if (!hasClientTimeout(tx)) {
    return null
  }

  return 'Client timeout - Backend still tracking'
}

/**
 * Format time elapsed in human-readable format.
 * 
 * @param tx - Transaction to get time elapsed for
 * @returns Human-readable time elapsed (e.g., "2 minutes ago", "1 hour ago", "Just now")
 */
export function getTimeElapsed(tx: StoredTransaction): string {
  const now = Date.now()
  const elapsedMs = now - tx.createdAt

  if (elapsedMs < 1000) {
    return 'Just now'
  }

  const seconds = Math.floor(elapsedMs / 1000)
  if (seconds < 60) {
    return `${seconds} second${seconds !== 1 ? 's' : ''} ago`
  }

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`
  }

  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours} hour${hours !== 1 ? 's' : ''} ago`
  }

  const days = Math.floor(hours / 24)
  if (days < 7) {
    return `${days} day${days !== 1 ? 's' : ''} ago`
  }

  const weeks = Math.floor(days / 7)
  if (weeks < 4) {
    return `${weeks} week${weeks !== 1 ? 's' : ''} ago`
  }

  const months = Math.floor(days / 30)
  if (months < 12) {
    return `${months} month${months !== 1 ? 's' : ''} ago`
  }

  const years = Math.floor(days / 365)
  return `${years} year${years !== 1 ? 's' : ''} ago`
}

/**
 * Format duration in human-readable format.
 * 
 * @param durationMs - Duration in milliseconds
 * @returns Human-readable duration (e.g., "2 minutes", "1 hour 30 minutes")
 */
export function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return 'Less than a second'
  }

  const seconds = Math.floor(durationMs / 1000)
  if (seconds < 60) {
    return `${seconds} second${seconds !== 1 ? 's' : ''}`
  }

  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60

  if (minutes < 60) {
    if (remainingSeconds === 0) {
      return `${minutes} minute${minutes !== 1 ? 's' : ''}`
    }
    return `${minutes} minute${minutes !== 1 ? 's' : ''} ${remainingSeconds} second${remainingSeconds !== 1 ? 's' : ''}`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60

  if (hours < 24) {
    if (remainingMinutes === 0) {
      return `${hours} hour${hours !== 1 ? 's' : ''}`
    }
    return `${hours} hour${hours !== 1 ? 's' : ''} ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}`
  }

  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24

  if (days < 7) {
    if (remainingHours === 0) {
      return `${days} day${days !== 1 ? 's' : ''}`
    }
    return `${days} day${days !== 1 ? 's' : ''} ${remainingHours} hour${remainingHours !== 1 ? 's' : ''}`
  }

  return `${days} day${days !== 1 ? 's' : ''}`
}

/**
 * Extract stage timings from flow status.
 * Calculates duration spent in each stage based on occurredAt timestamps.
 * Includes client-side stages prepended before backend stages.
 * 
 * @param tx - Transaction with flow status snapshot
 * @param flowType - Flow type ('deposit' or 'payment')
 * @returns Array of stage timings ordered by occurrence
 */
export function getStageTimings(
  tx: StoredTransaction,
  flowType: 'deposit' | 'payment' = 'deposit',
): StageTiming[] {
  const timings: StageTiming[] = []

  // Use unified stage reading (handles pollingState, clientStages, and flowStatusSnapshot)
  const allStages = getAllStagesFromTransaction(tx, flowType)

  // Convert to StageTiming format
  for (const stage of allStages) {
      if (stage.occurredAt) {
        const occurredAt = new Date(stage.occurredAt).getTime()
      
      // Extract chain from metadata or determine from stage
      let chain: 'evm' | 'noble' | 'namada' = 'evm'
      if (stage.metadata?.chain) {
        chain = stage.metadata.chain as 'evm' | 'noble' | 'namada'
      } else {
        // Try to determine chain from pollingState (stages are stored per chain)
        if (tx.pollingState) {
          const chainOrder = getChainOrder(flowType)
          for (const c of chainOrder) {
            const chainStatus = tx.pollingState.chainStatus[c]
            if (chainStatus?.stages?.some((s) => s.stage === stage.stage)) {
              chain = c
              break
            }
      }
    }
        // Fallback: Try to determine chain from stage name or flowStatusSnapshot
        if (chain === 'evm' && tx.flowStatusSnapshot) {
    const chainOrder = getChainOrder(flowType)
          for (const c of chainOrder) {
            if (tx.flowStatusSnapshot?.chainProgress[c]?.stages?.some((s) => s.stage === stage.stage)) {
              chain = c
              break
            }
          }
        }
      }

            timings.push({
              stage: stage.stage,
              chain,
              status: stage.status || 'pending',
              occurredAt,
            })
    }
  }

  // Sort by occurredAt timestamp (chronological order)
  timings.sort((a, b) => a.occurredAt - b.occurredAt)

  // Calculate durations between stages
  for (let i = 0; i < timings.length; i++) {
    const current = timings[i]
    const next = timings[i + 1]

    if (next) {
      const durationMs = next.occurredAt - current.occurredAt
      current.durationMs = durationMs
      current.durationLabel = formatDuration(durationMs)
    } else {
      // Last stage: calculate duration from last update to now (if still pending)
      if (current.status === 'pending') {
        const durationMs = Date.now() - current.occurredAt
        current.durationMs = durationMs
        current.durationLabel = formatDuration(durationMs)
      }
    }
  }

  return timings
}

/**
 * Get total duration of a transaction.
 * 
 * @param tx - Transaction to get duration for
 * @returns Total duration in milliseconds, or undefined if transaction hasn't started
 */
export function getTotalDuration(tx: StoredTransaction): number | undefined {
  if (!tx.createdAt) {
    return undefined
  }

  const effectiveStatus = getEffectiveStatus(tx)
  const endTime = effectiveStatus === 'finalized' || effectiveStatus === 'error' || effectiveStatus === 'undetermined'
    ? tx.updatedAt
    : Date.now()

  return endTime - tx.createdAt
}

/**
 * Get human-readable total duration of a transaction.
 * 
 * @param tx - Transaction to get duration for
 * @returns Human-readable duration (e.g., "2 minutes", "1 hour 30 minutes")
 */
export function getTotalDurationLabel(tx: StoredTransaction): string {
  const durationMs = getTotalDuration(tx)
  if (durationMs === undefined) {
    return 'Not started'
  }

  return formatDuration(durationMs)
}

/**
 * Get current active stage from transaction.
 * 
 * @param tx - Transaction to get current stage for
 * @param flowType - Flow type ('deposit' or 'payment')
 * @returns Current active stage or null if not available
 */
export function getCurrentStage(
  tx: StoredTransaction,
  flowType: 'deposit' | 'payment' = 'deposit',
): StageTiming | null {
  const timings = getStageTimings(tx, flowType)
  
  // Find the most recent stage that is not confirmed (iterate backwards)
  for (let i = timings.length - 1; i >= 0; i--) {
    const timing = timings[i]
    if (timing.status !== 'confirmed' && timing.status !== 'failed') {
      return timing
    }
  }

  // If all stages are confirmed, return the last one (most recent)
  if (timings.length > 0) {
    return timings[timings.length - 1]
  }

  return null
}

/**
 * Get progress percentage for a transaction.
 * 
 * Calculates progress based on confirmed stages vs total expected stages for the flow.
 * Uses the flow progression model to determine total expected stages, ensuring progress
 * doesn't show 100% prematurely when only some stages have occurred.
 * 
 * @param tx - Transaction to get progress for
 * @param flowType - Flow type ('deposit' or 'payment')
 * @returns Progress percentage (0-100)
 */
export function getProgressPercentage(
  tx: StoredTransaction,
  flowType: 'deposit' | 'payment' = 'deposit',
): number {
  if (isSuccess(tx)) {
    return 100
  }

  if (isError(tx)) {
    return 0
  }

  // Check frontend polling state first (for frontend-managed flows)
  if (tx.pollingState) {
    if (tx.pollingState.flowStatus === 'success') {
      return 100
    }
    if (tx.pollingState.flowStatus === 'tx_error' || tx.pollingState.flowStatus === 'polling_error') {
      return 0
    }
    // For pending/cancelled flows, calculate progress from stages
    // Fall through to stage-based calculation below
  }

  if (!tx.flowStatusSnapshot && !tx.pollingState) {
    // Estimate progress based on effective transaction status
    const effectiveStatus = getEffectiveStatus(tx)
    const statusProgress: Record<string, number> = {
      idle: 0,
      'connecting-wallet': 5,
      building: 10,
      signing: 20,
      submitting: 30,
      broadcasted: 50,
    }

    return statusProgress[effectiveStatus] || 0
  }

  // Get all stage timings (includes client stages, polling stages, and backend stages)
  const timings = getStageTimings(tx, flowType)
  
  // Get expected backend stages for the flow from progression model
  const chainOrder = getChainOrder(flowType)
  const expectedStagesSet = new Set<string>()
  
  // Collect all expected backend stages from the progression model
  // This gives us the total number of stages that should occur for this flow type
  for (const chain of chainOrder) {
    const expectedStages = getExpectedStages(flowType, chain)
    for (const stage of expectedStages) {
      expectedStagesSet.add(stage)
    }
  }
  
  // Total expected backend stages (this is the denominator)
  const totalExpectedStages = expectedStagesSet.size
  
  if (totalExpectedStages === 0) {
    return 0
  }
  
  // Count confirmed stages that match expected stages
  // Exclude client-only stages (wallet_signing, wallet_broadcasting, wallet_broadcasted, gasless_*)
  // as they are ephemeral and not part of the flow progression
  // Note: Unified stage model includes both client and polling stages, but we only count
  // stages that are part of the expected flow progression
  const confirmedExpectedStages = timings.filter((t) => {
    // Skip client-only stages (these are tracked but don't count toward flow progress)
    const isClientStage = t.stage.startsWith('wallet_') || t.stage.startsWith('gasless_')
    if (isClientStage) {
      return false
    }
    // Only count stages that are in the expected stages set and are confirmed
    return t.status === 'confirmed' && expectedStagesSet.has(t.stage)
  }).length
  
  // Calculate progress: confirmed expected stages / total expected stages
  // Cap at 99% until flow is actually completed (to avoid showing 100% prematurely)
  const progress = Math.round((confirmedExpectedStages / totalExpectedStages) * 100)
  
  // Check if flow is actually completed (from pollingState or flowStatusSnapshot)
  const isCompleted = 
    tx.pollingState?.flowStatus === 'success' ||
    tx.flowStatusSnapshot?.status === 'completed'
  
  return isCompleted ? 100 : Math.min(progress, 99)
}

