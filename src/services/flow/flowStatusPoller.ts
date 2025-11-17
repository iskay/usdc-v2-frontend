import type { FlowStatus } from '@/types/flow'
import { getFlowStatus } from '@/services/api/backendClient'
import { flowStatusCacheService } from './flowStatusCacheService'
import { logger } from '@/utils/logger'

/**
 * Callback type for status updates
 */
export type StatusUpdateCallback = (flowId: string, status: FlowStatus) => void

/**
 * Callback type for timeout events
 */
export type TimeoutCallback = (flowId: string) => void

/**
 * Polling service for flow status with exponential backoff.
 * Polls active flows frequently, backs off for completed/failed flows.
 * Supports per-flow timeout configuration.
 */
class FlowStatusPoller {
  private intervals = new Map<string, NodeJS.Timeout>()
  private timeoutTimers = new Map<string, NodeJS.Timeout>()
  private pollCounts = new Map<string, number>()
  private callbacks = new Map<string, StatusUpdateCallback>()
  private timeoutCallbacks = new Map<string, TimeoutCallback>()
  private startTimes = new Map<string, number>() // Track when polling started for each flow

  /**
   * Start polling for a flow.
   * 
   * @param flowId - Backend flowId to poll
   * @param onUpdate - Optional callback for status updates
   * @param onTimeout - Optional callback for timeout events
   * @param timeoutMs - Optional timeout in milliseconds. If provided, will call onTimeout after this duration if flow hasn't completed.
   */
  startPolling(
    flowId: string,
    onUpdate?: StatusUpdateCallback,
    onTimeout?: TimeoutCallback,
    timeoutMs?: number,
  ): void {
    logger.debug('[FlowStatusPoller] startPolling called', {
      flowId,
      hasOnUpdate: !!onUpdate,
      hasOnTimeout: !!onTimeout,
      timeoutMs,
      isAlreadyPolling: this.intervals.has(flowId),
    })

    if (this.intervals.has(flowId)) {
      logger.info('[FlowStatusPoller] Already polling, updating callbacks', {
        flowId,
      })
      // Already polling, just update callbacks if provided
      if (onUpdate) {
        this.callbacks.set(flowId, onUpdate)
      }
      if (onTimeout) {
        this.timeoutCallbacks.set(flowId, onTimeout)
      }
      // Update timeout if provided
      if (timeoutMs !== undefined) {
        this.setTimeout(flowId, timeoutMs)
      }
      return
    }

    logger.info('[FlowStatusPoller] Starting new polling job', {
      flowId,
      timeoutMs,
    })

    // Set initial poll count
    this.pollCounts.set(flowId, 0)
    this.startTimes.set(flowId, Date.now())
    
    // Store callbacks if provided
    if (onUpdate) {
      this.callbacks.set(flowId, onUpdate)
    }
    if (onTimeout) {
      this.timeoutCallbacks.set(flowId, onTimeout)
    }

    // Set timeout if provided
    if (timeoutMs !== undefined && timeoutMs > 0) {
      this.setTimeout(flowId, timeoutMs)
      logger.debug('[FlowStatusPoller] Timeout configured', {
        flowId,
        timeoutMs,
      })
    }

    // Start polling
    logger.debug('[FlowStatusPoller] Initiating first poll', {
      flowId,
    })
    this.poll(flowId)
  }

  /**
   * Set or update timeout for a flow.
   */
  private setTimeout(flowId: string, timeoutMs: number): void {
    // Clear existing timeout if any
    const existingTimeout = this.timeoutTimers.get(flowId)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
    }

    // Set new timeout
    const timeoutTimer = setTimeout(() => {
      // Check if flow is still being polled (not completed)
      if (this.intervals.has(flowId)) {
        const callback = this.timeoutCallbacks.get(flowId)
        if (callback) {
          callback(flowId)
        }
        // Stop polling on timeout
        this.stopPolling(flowId)
      }
      this.timeoutTimers.delete(flowId)
    }, timeoutMs)

    this.timeoutTimers.set(flowId, timeoutTimer)
  }

  /**
   * Stop polling for a flow.
   * 
   * @param flowId - Backend flowId to stop polling
   */
  stopPolling(flowId: string): void {
    const interval = this.intervals.get(flowId)
    if (interval) {
      clearTimeout(interval)
      this.intervals.delete(flowId)
      this.pollCounts.delete(flowId)
      this.callbacks.delete(flowId)
    }

    // Clear timeout timer if any
    const timeoutTimer = this.timeoutTimers.get(flowId)
    if (timeoutTimer) {
      clearTimeout(timeoutTimer)
      this.timeoutTimers.delete(flowId)
    }

    // Clean up timeout callback and start time
    this.timeoutCallbacks.delete(flowId)
    this.startTimes.delete(flowId)
  }

  /**
   * Stop polling for all flows.
   */
  stopAllPolling(): void {
    for (const flowId of this.intervals.keys()) {
      this.stopPolling(flowId)
    }
  }

  /**
   * Internal polling function with exponential backoff.
   */
  private async poll(flowId: string): Promise<void> {
    const pollCount = this.pollCounts.get(flowId) || 0
    logger.debug('[FlowStatusPoller] Polling flow status', {
      flowId,
      pollCount: pollCount + 1,
      startTime: this.startTimes.get(flowId),
      elapsedMs: this.startTimes.get(flowId) ? Date.now() - this.startTimes.get(flowId)! : undefined,
    })

    try {
      logger.debug('[FlowStatusPoller] Fetching flow status from backend', {
        flowId,
        endpoint: `/flow/${flowId}/status`,
        pollCount: pollCount + 1,
      })

      const status = await getFlowStatus(flowId)

      logger.debug('[FlowStatusPoller] Received flow status', {
        flowId,
        status: status.status,
        hasCallbacks: this.callbacks.has(flowId),
      })
      
      // Update cache
      flowStatusCacheService.cacheFlowStatus(flowId, status)
      
      // Notify callback
      const callback = this.callbacks.get(flowId)
      if (callback) {
        logger.debug('[FlowStatusPoller] Calling status update callback', {
          flowId,
          status: status.status,
        })
        callback(flowId, status)
      } else {
        logger.warn('[FlowStatusPoller] No callback registered for flowId, stopping polling', {
          flowId,
        })
        // If callback missing but still polling, stop polling to prevent infinite polling
        this.stopPolling(flowId)
        return
      }

      // Stop polling if flow is complete or undetermined (also clears timeout)
      if (status.status === 'completed' || status.status === 'failed' || status.status === 'undetermined') {
        logger.info('[FlowStatusPoller] Flow completed/undetermined, stopping polling', {
          flowId,
          status: status.status,
          totalPolls: pollCount + 1,
        })
        this.stopPolling(flowId)
        return
      }

      // Calculate delay with exponential backoff
      const nextPollCount = pollCount + 1
      this.pollCounts.set(flowId, nextPollCount)

      // Active flows: poll every 15 seconds for first 10 polls, then 30 seconds after
      const delay = nextPollCount > 10 ? 30000 : 15000

      logger.debug('[FlowStatusPoller] Scheduling next poll', {
        flowId,
        delayMs: delay,
        nextPollCount,
        nextPollIn: `${delay / 1000}s`,
      })

      // Schedule next poll
      const interval = setTimeout(() => {
        this.poll(flowId)
      }, delay)

      this.intervals.set(flowId, interval)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.warn('[FlowStatusPoller] Polling error, will retry at next normal interval', {
        flowId,
        pollCount: pollCount + 1,
        error: errorMessage,
        errorStack: error instanceof Error ? error.stack : undefined,
      })

      // Increment pollCount on error too - errors should also contribute to backoff
      // This ensures we slow down even when backend is unreachable
      const nextPollCount = pollCount + 1
      this.pollCounts.set(flowId, nextPollCount)

      // Use same delay calculation as normal polling
      const delay = nextPollCount > 10 ? 30000 : 15000

      logger.debug('[FlowStatusPoller] Scheduling next poll after error', {
        flowId,
        delayMs: delay,
        nextPollCount,
        nextPollIn: `${delay / 1000}s`,
      })

      // Schedule next poll using normal interval
      const interval = setTimeout(() => {
        this.poll(flowId)
      }, delay)

      this.intervals.set(flowId, interval)
    }
  }

  /**
   * Check if a flow is currently being polled.
   */
  isPolling(flowId: string): boolean {
    return this.intervals.has(flowId)
  }
}

// Export singleton instance
export const flowStatusPoller = new FlowStatusPoller()

