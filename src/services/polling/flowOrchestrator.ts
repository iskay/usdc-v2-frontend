/**
 * Flow Orchestrator
 * 
 * Manages the lifecycle of a single transaction flow, orchestrating chain polling jobs
 * in the correct order and handling metadata passing between chains.
 * 
 * Each flow gets its own orchestrator instance for complete encapsulation.
 */

import type {
  ChainPoller,
  ChainPollParams,
  ChainPollResult,
  FlowPollingStatus,
  ChainStatus,
  ChainStatusValue,
  EvmPollParams,
  NoblePollParams,
  NamadaPollParams,
} from './types'
import type { ChainKey, FlowType } from '@/shared/flowStages'
import {
  getChainOrder,
  getExpectedStages,
  getChainForStage,
  type FlowStage,
} from '@/shared/flowStages'
import {
  updatePollingState,
  updateChainStatus,
  findLatestCompletedStage,
  determineNextStage,
  getPollingState,
} from './pollingStateManager'
import { getChainTimeout, calculateGlobalTimeout } from './timeoutConfig'
import { createEvmPoller } from './evmPoller'
import { createNoblePoller } from './noblePoller'
import { createNamadaPoller } from './namadaPoller'
import { logger } from '@/utils/logger'
import type { StoredTransaction } from '@/services/tx/transactionStorageService'

/**
 * Flow Orchestrator Options
 */
export interface FlowOrchestratorOptions {
  /** Transaction ID */
  txId: string
  /** Flow type */
  flowType: FlowType
  /** Initial metadata for first chain */
  initialMetadata?: Record<string, unknown>
  /** Transaction object (for accessing existing state) */
  transaction?: StoredTransaction
}

/**
 * Flow Orchestrator Class
 * 
 * Manages the lifecycle of a single transaction flow.
 * Each instance is completely isolated from other flows.
 */
export class FlowOrchestrator {
  private readonly txId: string
  private readonly flowType: FlowType
  private readonly abortController: AbortController
  private readonly pollers: Map<ChainKey, ChainPoller>
  private isRunning: boolean = false
  private isPaused: boolean = false
  private currentChainJob: Promise<void> | null = null
  private globalTimeoutTimer: NodeJS.Timeout | null = null

  constructor(options: FlowOrchestratorOptions) {
    this.txId = options.txId
    this.flowType = options.flowType
    this.abortController = new AbortController()

    // Initialize chain pollers (interface-based, modular)
    this.pollers = new Map([
      ['evm', createEvmPoller()],
      ['noble', createNoblePoller()],
      ['namada', createNamadaPoller()],
    ])

    // Initialize polling state if not exists
    const existingState = options.transaction?.pollingState
    if (!existingState) {
      this.initializePollingState(options.initialMetadata)
    }
  }

  /**
   * Initialize polling state for new flow
   */
  private initializePollingState(initialMetadata?: Record<string, unknown>): void {
    updatePollingState(this.txId, {
      flowStatus: 'pending',
      chainStatus: {},
      flowType: this.flowType,
      chainParams: {},
      startedAt: Date.now(),
      lastUpdatedAt: Date.now(),
      ...(initialMetadata && {
        chainParams: {
          [this.flowType === 'deposit' ? 'evm' : 'namada']: {
            metadata: initialMetadata,
          } as any,
        },
      }),
    })
  }

  /**
   * Get abort signal for polling jobs
   */
  getAbortSignal(): AbortSignal {
    return this.abortController.signal
  }

  /**
   * Cancel flow (immediately halt all polling jobs)
   */
  cancelFlow(): void {
    if (this.abortController.signal.aborted) {
      return
    }

    logger.info('[FlowOrchestrator] Cancelling flow', {
      txId: this.txId,
      flowType: this.flowType,
    })

    this.abortController.abort()
    this.isPaused = false

    // Update flow status to cancelled
    updatePollingState(this.txId, {
      flowStatus: 'cancelled',
    })

    // Update current chain status to cancelled if exists
    const state = getPollingState(this.txId)
    if (state?.currentChain) {
      updateChainStatus(this.txId, state.currentChain, {
        status: 'cancelled',
      })
    }
  }

  /**
   * Pause flow (stop polling but preserve state for resume)
   */
  pauseFlow(): void {
    if (this.isPaused || this.abortController.signal.aborted) {
      return
    }

    logger.info('[FlowOrchestrator] Pausing flow', {
      txId: this.txId,
      flowType: this.flowType,
    })

    this.isPaused = true
    this.abortController.abort()

    // Store last active timestamp
    updatePollingState(this.txId, {
      lastActiveAt: Date.now(),
    })
  }

  /**
   * Resume flow from pause
   * Note: Since abort controller was aborted, we need to recreate orchestrator
   * This method just marks as not paused - actual resume is handled by chainPollingService.resumePolling()
   */
  resumeFromPause(): void {
    if (!this.isPaused) {
      return
    }

    logger.info('[FlowOrchestrator] Marking flow as resumed from pause', {
      txId: this.txId,
      flowType: this.flowType,
    })

    // Mark as not paused
    // Note: Actual resume will be handled by recreating orchestrator via chainPollingService.resumePolling()
    this.isPaused = false
  }

  /**
   * Check if flow is paused
   */
  getIsPaused(): boolean {
    return this.isPaused
  }

  /**
   * Start entire flow from beginning
   */
  async startFlow(): Promise<void> {
    if (this.isRunning) {
      logger.warn('[FlowOrchestrator] Flow already running', {
        txId: this.txId,
      })
      return
    }

    this.isRunning = true
    logger.info('[FlowOrchestrator] Starting flow from beginning', {
      txId: this.txId,
      flowType: this.flowType,
    })

    try {
      // Reset polling state
      updatePollingState(this.txId, {
        flowStatus: 'pending',
        chainStatus: {},
        latestCompletedStage: undefined,
        currentChain: undefined,
        startedAt: Date.now(),
        lastUpdatedAt: Date.now(),
      })

      // Start from first chain
      await this.executeFlow()
    } finally {
      this.isRunning = false
    }
  }

  /**
   * Resume flow from latest completed stage
   */
  async resumeFlow(): Promise<void> {
    if (this.isRunning) {
      logger.warn('[FlowOrchestrator] Flow already running', {
        txId: this.txId,
      })
      return
    }

    this.isRunning = true
    logger.info('[FlowOrchestrator] Resuming flow', {
      txId: this.txId,
      flowType: this.flowType,
    })

    try {
      const state = getPollingState(this.txId)
      if (!state) {
        logger.warn('[FlowOrchestrator] No polling state found, starting fresh', {
          txId: this.txId,
        })
        await this.startFlow()
        return
      }

      // Update status to pending if it was cancelled
      if (state.flowStatus === 'cancelled') {
        updatePollingState(this.txId, {
          flowStatus: 'pending',
        })
      }

      // Resume from where we left off
      await this.executeFlow()
    } finally {
      this.isRunning = false
    }
  }

  /**
   * Start single chain job in isolation
   */
  async startChainJob(chain: ChainKey, options?: { resume?: boolean }): Promise<void> {
    if (this.isRunning) {
      logger.warn('[FlowOrchestrator] Flow already running', {
        txId: this.txId,
        chain,
      })
      return
    }

    this.isRunning = true
    logger.info('[FlowOrchestrator] Starting single chain job', {
      txId: this.txId,
      chain,
      resume: options?.resume,
    })

    try {
      await this.executeChainJob(chain, options?.resume)
    } finally {
      this.isRunning = false
    }
  }

  /**
   * Execute entire flow (from current position or beginning)
   */
  private async executeFlow(): Promise<void> {
    const chainOrder = getChainOrder(this.flowType)
    const state = getPollingState(this.txId)

    // Determine starting chain based on latest completed stage
    let startIndex = 0
    if (state?.latestCompletedStage) {
      const latestStage = state.latestCompletedStage
      const latestChain = getChainForStage(latestStage as FlowStage, this.flowType)

      if (latestChain) {
        const latestIndex = chainOrder.indexOf(latestChain)
        // Start from next chain if current chain is complete
        const expectedStages = getExpectedStages(this.flowType, latestChain)
        const isChainComplete = state.chainStatus[latestChain]?.status === 'success'

        if (isChainComplete && latestIndex < chainOrder.length - 1) {
          startIndex = latestIndex + 1
        } else {
          // Resume current chain if not complete
          startIndex = latestIndex
        }
      }
    }

    // Set up global timeout
    await this.setupGlobalTimeout(chainOrder)

    // Execute chains in order
    for (let i = startIndex; i < chainOrder.length; i++) {
      if (this.abortController.signal.aborted) {
        logger.info('[FlowOrchestrator] Flow aborted, stopping execution', {
          txId: this.txId,
        })
        // Clear global timeout timer
        if (this.globalTimeoutTimer) {
          clearTimeout(this.globalTimeoutTimer)
          this.globalTimeoutTimer = null
        }
        break
      }

      const chain = chainOrder[i]
      await this.executeChainJob(chain, true)

      // Check if chain timed out - if so, mark it and continue to next chain
      // (unless it's a critical chain that prevents flow continuation)
      const currentState = getPollingState(this.txId)
      const chainStatus = currentState?.chainStatus[chain]
      if (chainStatus?.status === 'polling_timeout') {
        logger.warn('[FlowOrchestrator] Chain timed out, continuing to next chain', {
          txId: this.txId,
          chain,
        })
        // Continue to next chain - timeout is not fatal for flow continuation
        // The flow will be marked as timeout at global level if all chains timeout
      }
    }

    // Clear global timeout timer if flow completed successfully
    if (this.globalTimeoutTimer) {
      clearTimeout(this.globalTimeoutTimer)
      this.globalTimeoutTimer = null
    }

    // Check if flow completed successfully
    await this.checkFlowCompletion()
  }

  /**
   * Execute a single chain polling job
   */
  private async executeChainJob(chain: ChainKey, resume: boolean = false): Promise<void> {
    const poller = this.pollers.get(chain)
    if (!poller) {
      logger.error('[FlowOrchestrator] Poller not found for chain', {
        txId: this.txId,
        chain,
      })
      return
    }

    const state = getPollingState(this.txId)
    if (!state) {
      logger.error('[FlowOrchestrator] Polling state not found', {
        txId: this.txId,
      })
      return
    }

    // Check if chain already completed
    const chainStatus = state.chainStatus[chain]
    if (chainStatus?.status === 'success') {
      logger.info('[FlowOrchestrator] Chain already completed, skipping', {
        txId: this.txId,
        chain,
      })
      return
    }

    // Update current chain
    updatePollingState(this.txId, {
      currentChain: chain,
    })

    // Update chain status to pending
    updateChainStatus(this.txId, chain, {
      status: 'pending',
      completedStages: chainStatus?.completedStages || [],
    })

    // Get chain timeout
    const chainTimeout = await getChainTimeout(
      state.chainParams[chain]?.metadata?.chainKey || chain,
      this.flowType,
    )

    // Build poll parameters
    const pollParams = this.buildPollParams(chain, chainTimeout, resume)

    logger.info('[FlowOrchestrator] Starting chain polling job', {
      txId: this.txId,
      chain,
      flowType: this.flowType,
      timeoutMs: chainTimeout,
    })

    // Set up chain-level timeout check
    const chainTimeoutTimer = setTimeout(() => {
      // Check if chain is still pending after timeout
      const currentState = getPollingState(this.txId)
      const currentChainStatus = currentState?.chainStatus[chain]
      if (currentChainStatus?.status === 'pending') {
        logger.warn('[FlowOrchestrator] Chain-level timeout reached', {
          txId: this.txId,
          chain,
          timeoutMs: chainTimeout,
        })

        updateChainStatus(this.txId, chain, {
          status: 'polling_timeout',
          errorType: 'polling_timeout',
          errorMessage: `Chain polling timed out after ${chainTimeout}ms`,
          timeoutOccurredAt: Date.now(),
        })
      }
    }, chainTimeout)

    try {
      // Execute polling job
      const result = await poller.poll(pollParams)

      // Clear chain timeout timer on success or error
      clearTimeout(chainTimeoutTimer)

      // Process result
      await this.processChainResult(chain, result)
    } catch (error) {
      // Clear chain timeout timer on exception
      clearTimeout(chainTimeoutTimer)
      const errorMessage = error instanceof Error ? error.message : String(error)
      const errorCode = (error as { code?: string | number }).code ||
        (error as { status?: number }).status ||
        (error as { response?: { status?: number } }).response?.status

      logger.error('[FlowOrchestrator] Chain polling job error', {
        txId: this.txId,
        chain,
        error: errorMessage,
        errorCode,
        errorType: error instanceof Error ? error.constructor.name : typeof error,
      })

      // Get current retry count
      const currentRetryCount = state.chainStatus[chain]?.retryCount || 0

      // Update chain status with error
      updateChainStatus(this.txId, chain, {
        status: 'polling_error',
        errorType: 'polling_error',
        errorMessage: errorMessage,
        errorCode: errorCode?.toString(),
        errorOccurredAt: Date.now(),
        retryCount: currentRetryCount + 1,
        lastRetryAt: Date.now(),
      })
    }
  }

  /**
   * Build poll parameters for a chain
   */
  private buildPollParams(
    chain: ChainKey,
    timeoutMs: number,
    resume: boolean,
  ): ChainPollParams {
    const state = getPollingState(this.txId)
    if (!state) {
      throw new Error('Polling state not found')
    }

    // Get existing chain params or create new
    const chainParams = state.chainParams[chain] || {
      flowId: this.txId,
      chain,
      timeoutMs,
      intervalMs: 5000,
      abortSignal: this.abortController.signal,
      metadata: {
        chainKey: this.getChainKey(chain),
        flowType: this.flowType,
      },
    }

    // Merge with existing metadata
    const existingMetadata = state.chainParams[chain]?.metadata || {}
    const metadata = {
      ...existingMetadata,
      ...chainParams.metadata,
    }

    return {
      ...chainParams,
      flowId: this.txId,
      chain,
      timeoutMs,
      abortSignal: this.abortController.signal,
      metadata,
    }
  }

  /**
   * Get actual chain key (e.g., 'sepolia', 'noble-testnet')
   */
  private getChainKey(chain: ChainKey): string {
    const state = getPollingState(this.txId)
    
    // Try to get from chain params metadata
    if (state?.chainParams[chain]?.metadata?.chainKey) {
      return state.chainParams[chain].metadata.chainKey as string
    }
    
    // Try to get from initial chain params
    const initialChain = this.flowType === 'deposit' ? 'evm' : 'namada'
    if (state?.chainParams[initialChain]?.metadata?.chainKey) {
      // For deposit: EVM chain key, Noble/Namada use defaults
      // For payment: Namada chain key, Noble/EVM use defaults
      if (chain === initialChain) {
        return state.chainParams[initialChain].metadata.chainKey as string
      }
    }
    
    // Fallback to defaults
    const defaults: Record<ChainKey, string> = {
      evm: 'sepolia',
      noble: 'noble-testnet',
      namada: 'namada-testnet',
    }
    return defaults[chain]
  }

  /**
   * Process chain polling result
   */
  private async processChainResult(chain: ChainKey, result: ChainPollResult): Promise<void> {
    const state = getPollingState(this.txId)
    if (!state) {
      return
    }

    if (result.success && result.found) {
      // Success - update chain status
      const completedStages = result.stages
        .filter((s) => s.status === 'confirmed')
        .map((s) => s.stage)

      // Merge new stages with existing stages
      const existingStages = state.chainStatus[chain]?.stages || []
      const newStages = result.stages || []
      const mergedStages = [...existingStages, ...newStages]

      updateChainStatus(this.txId, chain, {
        status: 'success',
        completedStages: [
          ...(state.chainStatus[chain]?.completedStages || []),
          ...completedStages,
        ],
        stages: mergedStages,
        completedAt: Date.now(),
        metadata: result.metadata,
      })

      // Update latest completed stage
      if (completedStages.length > 0) {
        const latestStage = completedStages[completedStages.length - 1]
        updatePollingState(this.txId, {
          latestCompletedStage: latestStage,
        })
      }

      // Merge metadata into chain params for next chain
      if (result.metadata) {
        const chainParams = state.chainParams[chain] || ({} as any)
        chainParams.metadata = {
          ...chainParams.metadata,
          ...result.metadata,
        }
        updatePollingState(this.txId, {
          chainParams: {
            ...state.chainParams,
            [chain]: chainParams,
          },
        })
      }
    } else if (result.error) {
      // Error - update chain status
      const currentRetryCount = state.chainStatus[chain]?.retryCount || 0
      
      updateChainStatus(this.txId, chain, {
        status: result.error.type as ChainStatusValue,
        errorType: result.error.type,
        errorMessage: result.error.message,
        errorCode: result.error.code?.toString(),
        errorCategory: result.error.category,
        isRecoverable: result.error.isRecoverable,
        recoveryAction: result.error.recoveryAction,
        errorOccurredAt: result.error.occurredAt,
        retryCount: currentRetryCount + 1,
        lastRetryAt: Date.now(),
        ...(result.error.type === 'polling_timeout' && {
          timeoutOccurredAt: result.error.occurredAt,
        }),
      })

      // Update flow status if critical error
      if (result.error.type === 'tx_error') {
        updatePollingState(this.txId, {
          flowStatus: 'tx_error',
          error: {
            type: result.error.type,
            message: result.error.message,
            occurredAt: result.error.occurredAt,
            chain,
          },
        })
      }
    }
  }

  /**
   * Set up global timeout for entire flow
   */
  private async setupGlobalTimeout(chainOrder: readonly ChainKey[]): Promise<void> {
    const globalTimeout = await calculateGlobalTimeout(chainOrder, this.flowType)
    const timeoutAt = Date.now() + globalTimeout

    updatePollingState(this.txId, {
      globalTimeoutAt: timeoutAt,
    })

    // Clear any existing timeout timer
    if (this.globalTimeoutTimer) {
      clearTimeout(this.globalTimeoutTimer)
    }

    // Set timeout to abort flow
    this.globalTimeoutTimer = setTimeout(() => {
      if (!this.abortController.signal.aborted) {
        logger.warn('[FlowOrchestrator] Global timeout reached', {
          txId: this.txId,
          timeoutMs: globalTimeout,
          timeoutAt,
        })

        this.abortController.abort()

        // Mark all pending chains as timed out
        const state = getPollingState(this.txId)
        if (state) {
          for (const chain of chainOrder) {
            const chainStatus = state.chainStatus[chain]
            if (chainStatus && chainStatus.status === 'pending') {
              updateChainStatus(this.txId, chain, {
                status: 'polling_timeout',
                errorType: 'polling_timeout',
                errorMessage: 'Global timeout reached before chain polling completed',
                timeoutOccurredAt: Date.now(),
              })
            }
          }
        }

        updatePollingState(this.txId, {
          flowStatus: 'polling_timeout',
          error: {
            type: 'polling_timeout',
            message: `Global timeout reached after ${globalTimeout}ms`,
            occurredAt: Date.now(),
          },
        })

        this.globalTimeoutTimer = null
      }
    }, globalTimeout)
  }

  /**
   * Check if flow completed successfully
   */
  private async checkFlowCompletion(): Promise<void> {
    const state = getPollingState(this.txId)
    if (!state) {
      return
    }

    const chainOrder = getChainOrder(this.flowType)
    const allChainsComplete = chainOrder.every(
      (chain) => state.chainStatus[chain]?.status === 'success',
    )

    if (allChainsComplete) {
      logger.info('[FlowOrchestrator] Flow completed successfully', {
        txId: this.txId,
        flowType: this.flowType,
      })

      updatePollingState(this.txId, {
        flowStatus: 'success',
        currentChain: undefined,
      })
    }
  }
}

/**
 * Create flow orchestrator instance
 */
export function createFlowOrchestrator(
  options: FlowOrchestratorOptions,
): FlowOrchestrator {
  return new FlowOrchestrator(options)
}

