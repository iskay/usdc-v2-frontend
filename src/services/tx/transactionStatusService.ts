/**
 * Transaction Status Service
 * 
 * Centralizes status determination logic and provides utilities for transaction display.
 * This service provides a single source of truth for transaction status checks and formatting.
 */

import type { StoredTransaction } from './transactionStorageService'
// import type { FlowStatus, ChainStage } from '@/types/flow'
// import { logger } from '@/utils/logger'
import { getChainOrder } from '@/shared/flowStages'

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
  // If flowStatusSnapshot exists and has a status, use it as authoritative source
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
  
  // Fallback to top-level status when flowStatusSnapshot is not available
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

  // First, add client-side stages if present
  if (tx.clientStages && tx.clientStages.length > 0) {
    for (const stage of tx.clientStages) {
      if (stage.occurredAt) {
        const occurredAt = new Date(stage.occurredAt).getTime()
        // Extract chain from metadata (stored there for client stages)
        const chain = (stage.metadata?.chain as 'evm' | 'noble' | 'namada') || 'evm'
        timings.push({
          stage: stage.stage,
          chain,
          status: stage.status || 'pending',
          occurredAt,
        })
      }
    }
  }

  // Then, add backend stages from flowStatusSnapshot
  if (tx.flowStatusSnapshot) {
    const flowStatus = tx.flowStatusSnapshot
    // Determine chain order based on flow type
    const chainOrder = getChainOrder(flowType)

    // Collect all stages with timestamps
    for (const chain of chainOrder) {
      const progress = flowStatus.chainProgress[chain]
      if (!progress) continue

      // Process regular stages
      if (progress.stages && progress.stages.length > 0) {
        for (const stage of progress.stages) {
          if (stage.occurredAt) {
            const occurredAt = new Date(stage.occurredAt).getTime()
            timings.push({
              stage: stage.stage,
              chain,
              status: stage.status || 'pending',
              occurredAt,
            })
          }
        }
      }

      // Process gasless stages
      if (progress.gaslessStages && progress.gaslessStages.length > 0) {
        for (const stage of progress.gaslessStages) {
          if (stage.occurredAt) {
            const occurredAt = new Date(stage.occurredAt).getTime()
            timings.push({
              stage: stage.stage,
              chain,
              status: stage.status || 'pending',
              occurredAt,
            })
          }
        }
      }
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

  if (!tx.flowStatusSnapshot) {
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

  const timings = getStageTimings(tx, flowType)
  if (timings.length === 0) {
    return 0
  }

  const confirmedStages = timings.filter((t) => t.status === 'confirmed').length
  return Math.round((confirmedStages / timings.length) * 100)
}

