/**
 * Orchestrator Registry
 * 
 * Tracks active FlowOrchestrator instances for pause/resume operations.
 * Used for page visibility handling and tab throttling.
 */

import type { FlowOrchestrator } from './flowOrchestrator'
import { logger } from '@/utils/logger'

/**
 * Registry of active orchestrators
 */
const orchestratorRegistry = new Map<string, FlowOrchestrator>()

/**
 * Register an orchestrator
 */
export function registerOrchestrator(txId: string, orchestrator: FlowOrchestrator): void {
  orchestratorRegistry.set(txId, orchestrator)
  logger.debug('[OrchestratorRegistry] Registered orchestrator', {
    txId,
    totalCount: orchestratorRegistry.size,
  })
}

/**
 * Unregister an orchestrator
 */
export function unregisterOrchestrator(txId: string): void {
  const removed = orchestratorRegistry.delete(txId)
  if (removed) {
    logger.debug('[OrchestratorRegistry] Unregistered orchestrator', {
      txId,
      remainingCount: orchestratorRegistry.size,
    })
  }
}

/**
 * Get an orchestrator by transaction ID
 */
export function getOrchestrator(txId: string): FlowOrchestrator | undefined {
  return orchestratorRegistry.get(txId)
}

/**
 * Get all active orchestrators
 */
export function getAllOrchestrators(): FlowOrchestrator[] {
  return Array.from(orchestratorRegistry.values())
}

/**
 * Pause all active orchestrators
 */
export function pauseAllOrchestrators(): void {
  const count = orchestratorRegistry.size
  logger.info('[OrchestratorRegistry] Pausing all orchestrators', {
    count,
  })

  for (const orchestrator of orchestratorRegistry.values()) {
    try {
      orchestrator.pauseFlow()
    } catch (error) {
      logger.error('[OrchestratorRegistry] Error pausing orchestrator', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

/**
 * Resume all paused orchestrators
 * Note: Since paused orchestrators have aborted controllers, we recreate them via chainPollingService
 */
export async function resumeAllOrchestrators(): Promise<void> {
  const count = orchestratorRegistry.size
  logger.info('[OrchestratorRegistry] Resuming all paused orchestrators', {
    count,
  })

  // Get list of paused transaction IDs
  const pausedTxIds: string[] = []
  for (const [txId, orchestrator] of orchestratorRegistry.entries()) {
    if (orchestrator.getIsPaused()) {
      pausedTxIds.push(txId)
      // Unregister old orchestrator (will be replaced by new one)
      unregisterOrchestrator(txId)
    }
  }

  // Resume each paused transaction by creating new orchestrator
  const { resumePolling } = await import('./chainPollingService')
  const resumePromises = pausedTxIds.map((txId) =>
    resumePolling(txId).catch((error) => {
      logger.error('[OrchestratorRegistry] Error resuming orchestrator', {
        txId,
        error: error instanceof Error ? error.message : String(error),
      })
    }),
  )

  await Promise.all(resumePromises)
}

/**
 * Clear all orchestrators (cleanup)
 */
export function clearAllOrchestrators(): void {
  const count = orchestratorRegistry.size
  orchestratorRegistry.clear()
  logger.debug('[OrchestratorRegistry] Cleared all orchestrators', {
    count,
  })
}

