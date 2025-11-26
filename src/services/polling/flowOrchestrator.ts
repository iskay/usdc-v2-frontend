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
import { getStartHeightFromTimestamp } from './blockHeightLookup'
import { logger } from '@/utils/logger'
import type { StoredTransaction } from '@/services/tx/transactionStorageService'
import { transactionStorageService } from '@/services/tx/transactionStorageService'
import type { ChainStage } from '@/types/flow'
import { fetchTendermintChainsConfig } from '@/services/config/tendermintChainConfigService'
import { getDefaultNobleChainKey, getDefaultNamadaChainKey } from '@/config/chains'

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
    const initialChain = this.flowType === 'deposit' ? 'evm' : 'namada'
    
    logger.info('[FlowOrchestrator] Initializing polling state with initial metadata', {
      txId: this.txId,
      flowType: this.flowType,
      initialChain,
      hasInitialMetadata: !!initialMetadata,
      initialMetadataKeys: initialMetadata ? Object.keys(initialMetadata) : [],
      initialMetadataFields: initialMetadata ? {
        expectedAmountUusdc: 'expectedAmountUusdc' in initialMetadata,
        namadaReceiver: 'namadaReceiver' in initialMetadata,
        forwardingAddress: 'forwardingAddress' in initialMetadata,
      } : {},
      fullInitialMetadata: initialMetadata,
    })
    
    updatePollingState(this.txId, {
      flowStatus: 'pending',
      chainStatus: {},
      flowType: this.flowType,
      chainParams: {},
      startedAt: Date.now(),
      lastUpdatedAt: Date.now(),
      ...(initialMetadata && {
        chainParams: {
          [initialChain]: {
            metadata: initialMetadata,
          } as any,
        },
      }),
    })
    
    // Verify it was stored correctly
    const verifyState = getPollingState(this.txId)
    logger.info('[FlowOrchestrator] Verified initial metadata storage', {
      txId: this.txId,
      hasChainParams: !!verifyState?.chainParams,
      hasInitialChainParams: !!verifyState?.chainParams[initialChain],
      storedMetadataKeys: verifyState?.chainParams[initialChain]?.metadata ? Object.keys(verifyState.chainParams[initialChain].metadata) : [],
      storedMetadataHasInitialFields: verifyState?.chainParams[initialChain]?.metadata ? {
        expectedAmountUusdc: 'expectedAmountUusdc' in verifyState.chainParams[initialChain].metadata,
        namadaReceiver: 'namadaReceiver' in verifyState.chainParams[initialChain].metadata,
        forwardingAddress: 'forwardingAddress' in verifyState.chainParams[initialChain].metadata,
      } : {},
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
      logger.debug('[FlowOrchestrator] Flow already cancelled', {
        txId: this.txId,
      })
      return
    }

    logger.info('[FlowOrchestrator] Cancelling flow - aborting controller', {
      txId: this.txId,
      flowType: this.flowType,
      currentChain: getPollingState(this.txId)?.currentChain,
    })

    // Abort the controller - this will propagate to all pollers via abortSignal
    this.abortController.abort()
    this.isPaused = false

    logger.debug('[FlowOrchestrator] AbortController aborted', {
      txId: this.txId,
      signalAborted: this.abortController.signal.aborted,
    })

    // Update flow status to cancelled
    updatePollingState(this.txId, {
      flowStatus: 'cancelled',
    })

    // Update current chain status to cancelled if exists
    const state = getPollingState(this.txId)
    if (state?.currentChain) {
      logger.info('[FlowOrchestrator] Updating current chain status to cancelled', {
        txId: this.txId,
        chain: state.currentChain,
      })
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
      // Get current state to preserve chainParams (initial metadata)
      const currentState = getPollingState(this.txId)
      
      // If chainParams don't exist or are missing initial metadata, ensure they're set
      const initialChain = this.flowType === 'deposit' ? 'evm' : 'namada'
      let chainParamsToUse = currentState?.chainParams || {}
      
      // Check if initial metadata exists, if not, we need to ensure it's set
      // (This can happen if startFlow is called before initializePollingState, or if state was reset)
      if (!chainParamsToUse[initialChain]?.metadata || Object.keys(chainParamsToUse[initialChain].metadata).length === 0) {
        logger.warn('[FlowOrchestrator] Initial metadata missing in chainParams, attempting to restore', {
          txId: this.txId,
          initialChain,
          hasChainParams: !!chainParamsToUse[initialChain],
          hasMetadata: !!chainParamsToUse[initialChain]?.metadata,
          metadataKeys: chainParamsToUse[initialChain]?.metadata ? Object.keys(chainParamsToUse[initialChain].metadata) : [],
        })
        
        // Try to get initial metadata from transaction details as fallback
        const tx = transactionStorageService.getTransaction(this.txId)
        if (tx && this.flowType === 'deposit' && tx.depositDetails) {
          const details = tx.depositDetails
          const amountInBaseUnits = Math.round(parseFloat(details.amount) * 1_000_000).toString()
          const expectedAmountUusdc = `${amountInBaseUnits}uusdc`
          const chainKey = tx.chain || details.chainName.toLowerCase().replace(/\s+/g, '-')
          
          const restoredMetadata = {
            chainKey,
            txHash: tx.hash,
            recipient: tx.depositData?.nobleForwardingAddress || details.destinationAddress,
            amountBaseUnits: amountInBaseUnits,
            usdcAddress: tx.depositData?.usdcAddress,
            messageTransmitterAddress: tx.depositData?.messageTransmitterAddress,
            namadaReceiver: details.destinationAddress,
            expectedAmountUusdc,
            forwardingAddress: tx.depositData?.nobleForwardingAddress,
          }
          
          chainParamsToUse = {
            ...chainParamsToUse,
            [initialChain]: {
              ...chainParamsToUse[initialChain],
              metadata: restoredMetadata,
            },
          }
          
          logger.info('[FlowOrchestrator] Restored initial metadata from transaction', {
            txId: this.txId,
            restoredMetadataKeys: Object.keys(restoredMetadata),
          })
        }
      }
      
      // Reset polling state but preserve chainParams (contains initial metadata)
      updatePollingState(this.txId, {
        flowStatus: 'pending',
        chainStatus: {},
        latestCompletedStage: undefined,
        currentChain: undefined,
        startedAt: Date.now(),
        lastUpdatedAt: Date.now(),
        // Preserve chainParams to keep initial metadata (txHash, chainKey, etc.)
        chainParams: chainParamsToUse,
      })
      
      // Verify initial metadata is preserved
      const verifyState = getPollingState(this.txId)
      logger.info('[FlowOrchestrator] Verified chainParams after startFlow', {
        txId: this.txId,
        hasChainParams: !!verifyState?.chainParams,
        hasInitialChainParams: !!verifyState?.chainParams[initialChain],
        storedMetadataKeys: verifyState?.chainParams[initialChain]?.metadata ? Object.keys(verifyState.chainParams[initialChain].metadata) : [],
        storedMetadataHasInitialFields: verifyState?.chainParams[initialChain]?.metadata ? {
          expectedAmountUusdc: 'expectedAmountUusdc' in verifyState.chainParams[initialChain].metadata,
          namadaReceiver: 'namadaReceiver' in verifyState.chainParams[initialChain].metadata,
          forwardingAddress: 'forwardingAddress' in verifyState.chainParams[initialChain].metadata,
        } : {},
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

      // Check if chain timed out, errored, or requires user action
      const currentState = getPollingState(this.txId)
      const chainStatus = currentState?.chainStatus[chain]
      
      if (
        chainStatus?.status === 'polling_timeout' ||
        chainStatus?.status === 'polling_error' ||
        chainStatus?.status === 'user_action_required'
      ) {
        // user_action_required always stops the flow (requires user intervention)
        if (chainStatus.status === 'user_action_required') {
          logger.info('[FlowOrchestrator] Chain requires user action - stopping flow', {
            txId: this.txId,
            chain,
            chainStatus: chainStatus.status,
            errorMessage: chainStatus.errorMessage,
          })
          // Stop flow execution - user must take action before proceeding
          break
        }

        // Check if next chain requires prerequisites from this chain
        const nextChainIndex = i + 1
        if (nextChainIndex < chainOrder.length) {
          const nextChain = chainOrder[nextChainIndex]
          const requiresPrerequisites = await this.nextChainRequiresPrerequisites(chain, nextChain)
          
          if (requiresPrerequisites) {
            logger.error('[FlowOrchestrator] Chain failed and next chain requires prerequisites - stopping flow', {
              txId: this.txId,
              failedChain: chain,
              nextChain,
              chainStatus: chainStatus.status,
              reason: 'Cannot proceed to next chain without required prerequisites',
            })
            
            // Stop flow execution - cannot proceed without prerequisites
            // The flow status will be updated by checkFlowCompletion()
            break
          } else {
            // Next chain doesn't require prerequisites, log and continue
            logger.warn('[FlowOrchestrator] Chain failed, but next chain does not require prerequisites - continuing', {
              txId: this.txId,
              failedChain: chain,
              nextChain,
              chainStatus: chainStatus.status,
            })
          }
        } else {
          // This was the last chain, no next chain to check
          logger.debug('[FlowOrchestrator] Chain failed, but it was the last chain in the flow', {
            txId: this.txId,
            failedChain: chain,
            chainStatus: chainStatus.status,
          })
        }
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
   * Check if the next chain requires prerequisites from the current chain
   * 
   * @param currentChain - Chain that just timed out or errored
   * @param nextChain - Next chain in the flow
   * @returns True if next chain requires prerequisites from current chain
   */
  private async nextChainRequiresPrerequisites(currentChain: ChainKey, nextChain: ChainKey): Promise<boolean> {
    // Deposit flow: EVM → Noble → Namada
    if (this.flowType === 'deposit') {
      // Noble requires cctpNonce from EVM
      if (currentChain === 'evm' && nextChain === 'noble') {
        return true
      }
      // Namada requires packetSequence from Noble
      if (currentChain === 'noble' && nextChain === 'namada') {
        return true
      }
    }
    
    // Payment flow: Namada → Noble → EVM
    if (this.flowType === 'payment') {
      // Noble requires packetSequence from Namada
      if (currentChain === 'namada' && nextChain === 'noble') {
        return true
      }
      // EVM requires cctpNonce from Noble
      if (currentChain === 'noble' && nextChain === 'evm') {
        return true
      }
    }
    
    return false
  }

  /**
   * Validate prerequisites before starting a chain polling job
   * 
   * @param chain - Chain key to validate prerequisites for
   * @returns True if prerequisites are met, false otherwise
   */
  private async validateChainPrerequisites(chain: ChainKey): Promise<boolean> {
    const state = getPollingState(this.txId)
    if (!state) {
      return false
    }

    // Namada deposit flow prerequisites
    if (chain === 'namada' && this.flowType === 'deposit') {
      const tx = transactionStorageService.getTransaction(this.txId)
      
      // Required: namadaReceiver (can come from multiple sources)
      const namadaReceiver = state.chainParams.namada?.metadata?.namadaReceiver ||
                             state.chainParams.evm?.metadata?.namadaReceiver ||
                             tx?.depositDetails?.destinationAddress
      
      if (!namadaReceiver) {
        logger.warn('[FlowOrchestrator] Cannot start Namada polling: namadaReceiver missing', {
          txId: this.txId,
        })
        updateChainStatus(this.txId, chain, {
          status: 'polling_error',
          errorType: 'polling_error',
          errorMessage: 'Missing required parameter: namadaReceiver',
          errorOccurredAt: Date.now(),
        })
        return false
      }

      // Required: packetSequence from Noble (must be provided)
      const nobleStatus = state.chainStatus.noble
      const nobleResult = state.chainParams.noble?.metadata
      const hasPacketSequence = nobleResult && 'packetSequence' in nobleResult && nobleResult.packetSequence
      
      if (!hasPacketSequence) {
        logger.warn('[FlowOrchestrator] Cannot start Namada polling: packetSequence missing (Noble must complete first)', {
          txId: this.txId,
          nobleStatus: nobleStatus?.status,
          hasNobleMetadata: !!nobleResult,
        })
        updateChainStatus(this.txId, chain, {
          status: 'polling_error',
          errorType: 'polling_error',
          errorMessage: 'Missing required parameter: packetSequence. Noble polling must complete first.',
          errorOccurredAt: Date.now(),
        })
        return false
      }
      
      // Required: startHeight (will be calculated if missing)
      const namadaParams = state.chainParams.namada?.metadata as NamadaPollParams['metadata'] | undefined
      const hasStartHeight = namadaParams?.startHeight !== undefined && namadaParams.startHeight > 0
      
      if (!hasStartHeight) {
        // Validate that we can calculate it
        if (!tx?.createdAt) {
          logger.warn('[FlowOrchestrator] Cannot start Namada polling: startHeight missing and createdAt not available', {
            txId: this.txId,
          })
          updateChainStatus(this.txId, chain, {
            status: 'polling_error',
            errorType: 'polling_error',
            errorMessage: 'Missing required parameter: startHeight (cannot calculate from createdAt)',
            errorOccurredAt: Date.now(),
          })
          return false
        }
        // startHeight will be calculated in buildPollParams
      }

      logger.debug('[FlowOrchestrator] Namada deposit prerequisites validated', {
        txId: this.txId,
        hasNamadaReceiver: !!namadaReceiver,
        hasPacketSequence: !!hasPacketSequence,
        hasStartHeight: hasStartHeight,
        canCalculateStartHeight: !!tx?.createdAt,
        nobleStatus: nobleStatus?.status,
      })
    }

    // Noble deposit flow prerequisites
    if (chain === 'noble' && this.flowType === 'deposit') {
      const evmStatus = state.chainStatus.evm
      const evmResult = state.chainParams.evm?.metadata
      const hasCctpNonce = evmResult && 'cctpNonce' in evmResult && evmResult.cctpNonce

      if (!hasCctpNonce && evmStatus?.status !== 'success') {
        logger.warn('[FlowOrchestrator] Cannot start Noble polling: CCTP nonce missing and EVM not completed', {
          txId: this.txId,
          evmStatus: evmStatus?.status,
        })
        updateChainStatus(this.txId, chain, {
          status: 'polling_error',
          errorType: 'polling_error',
          errorMessage: 'Missing required parameter: cctpNonce (EVM polling must complete first)',
          errorOccurredAt: Date.now(),
        })
        return false
      }
    }

    return true
  }

  /**
   * Execute a single chain polling job
   */
  private async executeChainJob(chain: ChainKey, resume: boolean = false): Promise<void> {
    // Check if flow was cancelled before starting
    if (this.abortController.signal.aborted) {
      logger.debug('[FlowOrchestrator] Flow already cancelled, skipping chain job', {
        txId: this.txId,
        chain,
      })
      return
    }

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

    // Validate prerequisites before starting
    const prerequisitesMet = await this.validateChainPrerequisites(chain)
    if (!prerequisitesMet) {
      logger.warn('[FlowOrchestrator] Prerequisites not met, skipping chain polling job', {
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

    // Get chain timeout and build poll parameters
    // Wrap in try-catch to handle errors during setup (e.g., chain key determination)
    let chainTimeout: number
    let pollParams: ChainPollParams
    try {
      // Get chain timeout (use chain as fallback if chainKey not available yet)
      chainTimeout = await getChainTimeout(
        state.chainParams[chain]?.metadata?.chainKey || chain,
        this.flowType,
      )

      // Build poll parameters (async to allow for startHeight calculation)
      // This may throw if chain key cannot be determined
      pollParams = await this.buildPollParams(chain, chainTimeout, resume)
    } catch (setupError) {
      // If setup fails (e.g., cannot determine chain key), update chain status to error
      const errorMessage = setupError instanceof Error ? setupError.message : String(setupError)
      const errorCode = (setupError as { code?: string | number }).code ||
        (setupError as { status?: number }).status ||
        (setupError as { response?: { status?: number } }).response?.status

      logger.error('[FlowOrchestrator] Failed to setup chain polling job', {
        txId: this.txId,
        chain,
        error: errorMessage,
        errorCode,
      })

      // Update chain status with error
      const currentRetryCount = state.chainStatus[chain]?.retryCount || 0
      updateChainStatus(this.txId, chain, {
        status: 'polling_error',
        errorType: 'polling_error',
        errorMessage: errorMessage,
        errorCode: errorCode?.toString(),
        errorOccurredAt: Date.now(),
        retryCount: currentRetryCount,
        lastRetryAt: Date.now(),
      })

      // Check flow completion to update overall flowStatus
      await this.checkFlowCompletion()
      return
    }

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
      // Check abort signal before executing poller
      if (this.abortController.signal.aborted) {
        logger.debug('[FlowOrchestrator] Flow cancelled before poller execution', {
          txId: this.txId,
          chain,
        })
        updateChainStatus(this.txId, chain, {
          status: 'cancelled',
        })
        return
      }

      // Execute polling job
      const result = await poller.poll(pollParams)

      // Check abort signal after poller completes
      if (this.abortController.signal.aborted) {
        logger.debug('[FlowOrchestrator] Flow cancelled after poller execution', {
          txId: this.txId,
          chain,
        })
        return
      }

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

      // Check flow completion to update overall flowStatus
      await this.checkFlowCompletion()
    }
  }

  /**
   * Build poll parameters for a chain
   */
  private async buildPollParams(
    chain: ChainKey,
    timeoutMs: number,
    resume: boolean,
  ): Promise<ChainPollParams> {
    const state = getPollingState(this.txId)
    if (!state) {
      throw new Error('Polling state not found')
    }

    // Get existing chain params or create new
    const chainKey = await this.getChainKey(chain)
    const chainParams = state.chainParams[chain] || {
      flowId: this.txId,
      chain,
      timeoutMs,
      intervalMs: 5000,
      abortSignal: this.abortController.signal,
      metadata: {
        chainKey,
        flowType: this.flowType,
      },
    }

    // Merge with existing metadata
    const existingMetadata = state.chainParams[chain]?.metadata || {}
    
    // For the first chain in a flow, also check initial metadata from the initial chain
    // This ensures txHash and other initial metadata is preserved
    const initialChain = this.flowType === 'deposit' ? 'evm' : 'namada'
    const initialMetadata = chain === initialChain ? state.chainParams[initialChain]?.metadata || {} : {}
    
    // For deposit flows, also include metadata from previous chains
    // EVM -> Noble: pass cctpNonce from EVM + initial metadata (expectedAmountUusdc, namadaReceiver, forwardingAddress)
    // Noble -> Namada: pass packetSequence from Noble + initial metadata from EVM
    let previousChainMetadata: Record<string, unknown> = {}
    if (this.flowType === 'deposit') {
      if (chain === 'noble') {
        // Noble needs cctpNonce from EVM + initial metadata (expectedAmountUusdc, namadaReceiver, forwardingAddress)
        // Get initial metadata from EVM's chainParams (set during initialization)
        const evmInitialMetadata = state.chainParams.evm?.metadata || {}
        
        // Logging to trace metadata propagation
        logger.info('[FlowOrchestrator] Building Noble params - EVM metadata check', {
          txId: this.txId,
          hasEvmMetadata: !!state.chainParams.evm?.metadata,
          evmMetadataKeys: Object.keys(evmInitialMetadata),
          hasExpectedAmountUusdc: 'expectedAmountUusdc' in evmInitialMetadata,
          hasNamadaReceiver: 'namadaReceiver' in evmInitialMetadata,
          hasForwardingAddress: 'forwardingAddress' in evmInitialMetadata,
          expectedAmountUusdc: evmInitialMetadata.expectedAmountUusdc,
          namadaReceiver: evmInitialMetadata.namadaReceiver,
          forwardingAddress: evmInitialMetadata.forwardingAddress,
          fullEvmMetadata: evmInitialMetadata,
        })
        
        previousChainMetadata = {
          ...evmInitialMetadata, // This includes initial metadata + any result metadata from EVM
        }
      } else if (chain === 'namada') {
        // Namada needs packetSequence from Noble (and namadaReceiver from initial)
        // Include both EVM initial metadata and Noble result metadata
        previousChainMetadata = {
          ...(state.chainParams.evm?.metadata || {}), // Includes initial metadata
          ...(state.chainParams.noble?.metadata || {}),
        }
      }
    } else if (this.flowType === 'payment') {
      if (chain === 'noble') {
        // Noble needs packetSequence from Namada
        previousChainMetadata = state.chainParams.namada?.metadata || {}
      } else if (chain === 'evm') {
        // EVM needs cctpNonce from Noble
        previousChainMetadata = {
          ...(state.chainParams.namada?.metadata || {}),
          ...(state.chainParams.noble?.metadata || {}),
        }
      }
    }
    
    let metadata = {
      ...initialMetadata,
      ...previousChainMetadata,
      ...existingMetadata,
      ...chainParams.metadata,
    }
    
    // Ensure chainKey and flowType are set (may have been overridden)
    metadata.chainKey = await this.getChainKey(chain)
    metadata.flowType = this.flowType
    
    // Fallback: For EVM deposit flows, get txHash from transaction if missing
    if (chain === 'evm' && this.flowType === 'deposit' && !metadata.txHash) {
      const tx = transactionStorageService.getTransaction(this.txId)
      if (tx?.hash) {
        logger.debug('[FlowOrchestrator] Using txHash from transaction as fallback', {
          txId: this.txId,
          txHash: tx.hash,
        })
        metadata.txHash = tx.hash
      }
    }

    // For Namada deposit flows, ensure startHeight is calculated if missing
    if (chain === 'namada' && this.flowType === 'deposit') {
      const namadaParams = metadata as NamadaPollParams['metadata']
      if (!namadaParams.startHeight || namadaParams.startHeight === 0) {
        // Fetch start height from transaction creation timestamp
        const tx = transactionStorageService.getTransaction(this.txId)
        if (tx?.createdAt) {
          try {
            const chainKey = await this.getChainKey('namada')
            const startHeight = await getStartHeightFromTimestamp(
              chainKey,
              tx.createdAt,
            )
            
            logger.info('[FlowOrchestrator] Calculated Namada start height from timestamp', {
              txId: this.txId,
              chainKey,
              createdAt: tx.createdAt,
              startHeight,
            })

            metadata = {
              ...metadata,
              startHeight,
            } as NamadaPollParams['metadata']

            // Store in chain params for future use
            const updatedChainParams = {
              ...chainParams,
              metadata,
            }
            updatePollingState(this.txId, {
              chainParams: {
                ...state.chainParams,
                [chain]: updatedChainParams,
              },
            })
          } catch (error) {
            logger.warn('[FlowOrchestrator] Failed to calculate Namada start height, using fallback', {
              txId: this.txId,
              error: error instanceof Error ? error.message : String(error),
            })
            // Fallback: will use 0, which means poller will use latest block minus backscan
          }
        } else {
          logger.warn('[FlowOrchestrator] Transaction createdAt not found, cannot calculate start height', {
            txId: this.txId,
          })
        }
      }
    }

    // For Noble deposit flows, ensure cctpNonce is passed from EVM result
    if (chain === 'noble' && this.flowType === 'deposit') {
      const nobleParams = metadata as NoblePollParams['metadata']
      const evmMetadata = state.chainParams.evm?.metadata || {}
      
      // Explicitly pass initial metadata fields that Noble needs for packet_data matching
      // These should be in EVM's metadata (set during initialization), but ensure they're present
      const requiredInitialFields = {
        expectedAmountUusdc: evmMetadata.expectedAmountUusdc,
        namadaReceiver: evmMetadata.namadaReceiver,
        forwardingAddress: evmMetadata.forwardingAddress,
      }
      
      // Only add fields that exist (don't add undefined values)
      const fieldsToAdd: Record<string, unknown> = {}
      if (requiredInitialFields.expectedAmountUusdc) {
        fieldsToAdd.expectedAmountUusdc = requiredInitialFields.expectedAmountUusdc
      }
      if (requiredInitialFields.namadaReceiver) {
        fieldsToAdd.namadaReceiver = requiredInitialFields.namadaReceiver
      }
      if (requiredInitialFields.forwardingAddress) {
        fieldsToAdd.forwardingAddress = requiredInitialFields.forwardingAddress
      }
      
      if (Object.keys(fieldsToAdd).length > 0) {
        logger.info('[FlowOrchestrator] Adding initial metadata fields to Noble params', {
          txId: this.txId,
          fieldsAdded: Object.keys(fieldsToAdd),
        })
        metadata = {
          ...metadata,
          ...fieldsToAdd,
        } as NoblePollParams['metadata']
      } else {
        logger.warn('[FlowOrchestrator] Initial metadata fields missing from EVM metadata for Noble', {
          txId: this.txId,
          evmMetadataKeys: Object.keys(evmMetadata),
          hasExpectedAmountUusdc: 'expectedAmountUusdc' in evmMetadata,
          hasNamadaReceiver: 'namadaReceiver' in evmMetadata,
          hasForwardingAddress: 'forwardingAddress' in evmMetadata,
        })
      }
      
      // Pass cctpNonce from EVM result (required for Noble deposit polling)
      if (evmMetadata.cctpNonce !== undefined) {
        if (!nobleParams.cctpNonce) {
          logger.debug('[FlowOrchestrator] Passing cctpNonce from EVM to Noble', {
            txId: this.txId,
            cctpNonce: evmMetadata.cctpNonce,
          })
          metadata = {
            ...metadata,
            cctpNonce: evmMetadata.cctpNonce as number,
          } as NoblePollParams['metadata']
        }
      } else {
        logger.warn('[FlowOrchestrator] cctpNonce not found in EVM metadata for Noble deposit flow', {
          txId: this.txId,
          evmMetadataKeys: Object.keys(evmMetadata),
        })
      }
    }

    // For Namada deposit flows, ensure required metadata is present
    if (chain === 'namada' && this.flowType === 'deposit') {
      const namadaParams = metadata as NamadaPollParams['metadata']
      
      // Ensure namadaReceiver is set (from initial metadata or transaction)
      if (!namadaParams.namadaReceiver) {
        const tx = transactionStorageService.getTransaction(this.txId)
        const namadaReceiver = tx?.depositDetails?.destinationAddress ||
                               state.chainParams.evm?.metadata?.namadaReceiver
        if (namadaReceiver) {
          metadata = {
            ...metadata,
            namadaReceiver,
          } as NamadaPollParams['metadata']
        }
      }

      // Pass packetSequence from Noble result (required)
      const nobleResult = state.chainParams.noble?.metadata
      if (nobleResult && 'packetSequence' in nobleResult && nobleResult.packetSequence) {
        metadata = {
          ...metadata,
          packetSequence: nobleResult.packetSequence as number,
        } as NamadaPollParams['metadata']
      }
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
   * 
   * @throws Error if chain key cannot be determined (for EVM chains)
   */
  private async getChainKey(chain: ChainKey): Promise<string> {
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
    
    // Try to get from transaction's stored metadata
    const tx = transactionStorageService.getTransaction(this.txId)
    if (tx) {
      // For deposit flows, check transaction.chain first (might already be chain key)
      if (this.flowType === 'deposit' && chain === 'evm') {
        // Check if transaction.chain is the actual chain key (not just 'evm')
        if (tx.chain && tx.chain !== 'evm' && tx.chain !== 'noble' && tx.chain !== 'namada') {
          logger.debug('[FlowOrchestrator] Using chain key from transaction.chain', {
            txId: this.txId,
            chain: tx.chain,
          })
          return tx.chain
        }
        // Fallback to depositDetails.chainName
        if (tx.depositDetails?.chainName) {
          // Convert chain name to chain key (e.g., "Avalanche Fuji" -> "avalanche-fuji")
          const chainKey = tx.depositDetails.chainName.toLowerCase().replace(/\s+/g, '-')
          logger.debug('[FlowOrchestrator] Using chain key from depositDetails.chainName', {
            txId: this.txId,
            chainName: tx.depositDetails.chainName,
            chainKey,
          })
          return chainKey
        }
      }
      
      // For payment flows, check paymentDetails for chain information
      if (this.flowType === 'payment' && chain === 'namada') {
        // Check if transaction.chain is the actual chain key
        if (tx.chain && tx.chain !== 'evm' && tx.chain !== 'noble' && tx.chain !== 'namada') {
          logger.debug('[FlowOrchestrator] Using chain key from transaction.chain', {
            txId: this.txId,
            chain: tx.chain,
          })
          return tx.chain
        }
        // Fallback to paymentDetails.chainName
        if (tx.paymentDetails?.chainName) {
          const chainKey = tx.paymentDetails.chainName.toLowerCase().replace(/\s+/g, '-')
          logger.debug('[FlowOrchestrator] Using chain key from paymentDetails.chainName', {
            txId: this.txId,
            chainName: tx.paymentDetails.chainName,
            chainKey,
          })
          return chainKey
        }
      }
    }
    
    // For Tendermint chains (Noble, Namada), use defaults from config
    if (chain === 'noble' || chain === 'namada') {
      try {
        const tendermintConfig = await fetchTendermintChainsConfig()
        if (chain === 'noble') {
          const defaultNobleKey = getDefaultNobleChainKey(tendermintConfig)
          if (defaultNobleKey) {
            logger.debug('[FlowOrchestrator] Using default Noble chain key from config', {
              txId: this.txId,
              chainKey: defaultNobleKey,
            })
            return defaultNobleKey
          }
        } else if (chain === 'namada') {
          const defaultNamadaKey = getDefaultNamadaChainKey(tendermintConfig)
          if (defaultNamadaKey) {
            logger.debug('[FlowOrchestrator] Using default Namada chain key from config', {
              txId: this.txId,
              chainKey: defaultNamadaKey,
            })
            return defaultNamadaKey
          }
        }
      } catch (error) {
        logger.warn('[FlowOrchestrator] Failed to load Tendermint config for default chain key', {
          txId: this.txId,
          chain,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    
    // Hardcoded fallback for Tendermint chains if config loading fails
    if (chain === 'noble') {
      logger.debug('[FlowOrchestrator] Using hardcoded Noble chain key fallback', {
        txId: this.txId,
        chainKey: 'noble-testnet',
      })
      return 'noble-testnet'
    }
    if (chain === 'namada') {
      logger.debug('[FlowOrchestrator] Using hardcoded Namada chain key fallback', {
        txId: this.txId,
        chainKey: 'namada-testnet',
      })
      return 'namada-testnet'
    }
    
    // No fallback for EVM chains - throw error if chain key cannot be determined
    throw new Error(
      `Cannot determine chain key for ${chain} chain in ${this.flowType} flow. ` +
      `Transaction ID: ${this.txId}. ` +
      `Please ensure chainKey is set in initialMetadata when starting polling.`
    )
  }

  /**
   * Merge stages intelligently: check if stage exists and overwrite instead of duplicating
   * Preserves original timestamp but updates status/metadata if changed
   * 
   * @param existingStages - Existing stages for the chain
   * @param newStages - New stages from poller result
   * @returns Merged stages array without duplicates
   */
  private mergeStagesIntelligently(
    existingStages: ChainStage[],
    newStages: ChainStage[],
  ): ChainStage[] {
    const merged: ChainStage[] = [...existingStages]
    
    for (const newStage of newStages) {
      // Find existing stage with same name
      const existingIndex = merged.findIndex((s) => s.stage === newStage.stage)
      
      if (existingIndex >= 0) {
        // Stage exists - overwrite but preserve original timestamp
        const existingStage = merged[existingIndex]
        merged[existingIndex] = {
          ...newStage,
          // Preserve original timestamp (first occurrence)
          occurredAt: existingStage.occurredAt || newStage.occurredAt,
          // Update status if it changed (e.g., pending -> confirmed)
          status: newStage.status || existingStage.status,
          // Merge metadata (new takes precedence)
          metadata: {
            ...existingStage.metadata,
            ...newStage.metadata,
          },
        }
      } else {
        // New stage - add it
        merged.push(newStage)
      }
    }
    
    return merged
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

      // Merge new stages with existing stages (intelligently - overwrite duplicates)
      const existingStages = state.chainStatus[chain]?.stages || []
      const newStages = result.stages || []
      const mergedStages = this.mergeStagesIntelligently(existingStages, newStages)

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
      // IMPORTANT: Preserve existing metadata (including initial metadata) when merging result metadata
      if (result.metadata) {
        // Re-read state to ensure we have the latest
        const latestState = getPollingState(this.txId)
        const existingChainParams = latestState?.chainParams[chain]
        const existingMetadata = existingChainParams?.metadata || {}
        
        logger.info('[FlowOrchestrator] Merging chain result metadata', {
          txId: this.txId,
          chain,
          existingMetadataKeys: Object.keys(existingMetadata),
          existingMetadataHasInitialFields: {
            expectedAmountUusdc: 'expectedAmountUusdc' in existingMetadata,
            namadaReceiver: 'namadaReceiver' in existingMetadata,
            forwardingAddress: 'forwardingAddress' in existingMetadata,
          },
          resultMetadataKeys: Object.keys(result.metadata),
          existingMetadata: existingMetadata, // Log full existing metadata for debugging
        })
        
        // Merge: existing metadata (includes initial) + result metadata
        const mergedMetadata = {
          ...existingMetadata,  // Preserve initial metadata (expectedAmountUusdc, namadaReceiver, forwardingAddress, etc.)
          ...result.metadata,   // Add result metadata (cctpNonce, irisLookupID, etc.)
        }
        
        const chainParams = {
          ...existingChainParams,  // Preserve other chainParams fields (flowId, chain, timeoutMs, etc.)
          metadata: mergedMetadata,
        }
        
        updatePollingState(this.txId, {
          chainParams: {
            ...latestState?.chainParams || {},
            [chain]: chainParams,
          },
        })
        
        logger.info('[FlowOrchestrator] Merged chain result metadata', {
          txId: this.txId,
          chain,
          mergedMetadataKeys: Object.keys(mergedMetadata),
          preservedInitialFields: {
            expectedAmountUusdc: 'expectedAmountUusdc' in mergedMetadata,
            namadaReceiver: 'namadaReceiver' in mergedMetadata,
            forwardingAddress: 'forwardingAddress' in mergedMetadata,
          },
          mergedMetadata: mergedMetadata, // Log full merged metadata for debugging
        })
      }
    } else if (result.error) {
      // Error or user_action_required - preserve stages and metadata
      const existingStages = state.chainStatus[chain]?.stages || []
      const resultStages = result.stages || []
      // Merge intelligently - overwrite duplicates instead of appending
      const mergedStages = resultStages.length > 0 
        ? this.mergeStagesIntelligently(existingStages, resultStages)
        : existingStages

      // Extract confirmed stages to add to completedStages
      const confirmedStages = mergedStages
        .filter((s) => s.status === 'confirmed')
        .map((s) => s.stage)

      // Merge with existing completedStages (avoid duplicates)
      const existingCompletedStages = state.chainStatus[chain]?.completedStages || []
      const newCompletedStages = [
        ...existingCompletedStages,
        ...confirmedStages.filter((s) => !existingCompletedStages.includes(s)),
      ]

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
        completedStages: newCompletedStages.length > 0 ? newCompletedStages : undefined, // Preserve completed stages
        stages: mergedStages.length > 0 ? mergedStages : undefined, // Preserve stages
        ...(result.error.type === 'polling_timeout' && {
          timeoutOccurredAt: result.error.occurredAt,
        }),
        // Preserve metadata if available (e.g., packetSequence for user_action_required)
        ...(result.metadata && Object.keys(result.metadata).length > 0 && {
          metadata: {
            ...(state.chainStatus[chain]?.metadata || {}),
            ...result.metadata,
          },
        }),
      })

      // Preserve metadata in chain params even on error (for resumability)
      if (result.metadata && Object.keys(result.metadata).length > 0) {
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

      // Update flow status based on error type
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
      } else if (result.error.type === 'user_action_required') {
        updatePollingState(this.txId, {
          flowStatus: 'user_action_required',
          error: {
            type: result.error.type,
            message: result.error.message,
            occurredAt: result.error.occurredAt,
            chain,
          },
        })
      }

      // Check flow completion to update overall flowStatus
      // This ensures flowStatus is updated even for polling_error/polling_timeout
      await this.checkFlowCompletion()
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
   * Check if flow completed (successfully or with errors)
   * Updates overall flowStatus based on chain statuses
   */
  private async checkFlowCompletion(): Promise<void> {
    const state = getPollingState(this.txId)
    if (!state) {
      return
    }

    const chainOrder = getChainOrder(this.flowType)
    
    // Check if all chains completed successfully
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
      
      // Update top-level transaction status to reflect successful completion
      // This ensures UI displays the correct status even when flowStatusSnapshot is not available
      transactionStorageService.updateTransaction(this.txId, {
        status: 'finalized',
      })
      
      return
    }

    // Check if all chains have errored, timed out, or require user action (flow cannot continue)
    const allChainsErrored = chainOrder.every((chain) => {
      const chainStatus = state.chainStatus[chain]
      if (!chainStatus) {
        return false // Chain not started yet
      }
      return (
        chainStatus.status === 'tx_error' ||
        chainStatus.status === 'polling_error' ||
        chainStatus.status === 'polling_timeout' ||
        chainStatus.status === 'user_action_required'
      )
    })

    if (allChainsErrored) {
      // Determine the most severe error type
      // Priority: user_action_required > tx_error > polling_error > polling_timeout
      let overallErrorType: 'user_action_required' | 'tx_error' | 'polling_error' | 'polling_timeout' = 'polling_error'
      let overallErrorMessage = 'All chains encountered errors'
      let overallErrorOccurredAt = Date.now()

      for (const chain of chainOrder) {
        const chainStatus = state.chainStatus[chain]
        if (chainStatus?.status === 'user_action_required') {
          overallErrorType = 'user_action_required'
          overallErrorMessage = chainStatus.errorMessage || 'User action required on all chains'
          overallErrorOccurredAt = chainStatus.errorOccurredAt || Date.now()
          break // Highest priority, stop checking
        } else if (chainStatus?.status === 'tx_error' && overallErrorType !== 'user_action_required') {
          overallErrorType = 'tx_error'
          overallErrorMessage = chainStatus.errorMessage || 'Transaction error on all chains'
          overallErrorOccurredAt = chainStatus.errorOccurredAt || Date.now()
        } else if (
          chainStatus?.status === 'polling_error' &&
          overallErrorType !== 'user_action_required' &&
          overallErrorType !== 'tx_error'
        ) {
          overallErrorType = 'polling_error'
          overallErrorMessage = chainStatus.errorMessage || 'Polling error on all chains'
          overallErrorOccurredAt = chainStatus.errorOccurredAt || Date.now()
        } else if (
          chainStatus?.status === 'polling_timeout' &&
          overallErrorType === 'polling_timeout'
        ) {
          overallErrorMessage = chainStatus.errorMessage || 'Polling timeout on all chains'
          overallErrorOccurredAt = chainStatus.timeoutOccurredAt || Date.now()
        }
      }

      logger.warn('[FlowOrchestrator] Flow failed - all chains errored', {
        txId: this.txId,
        flowType: this.flowType,
        overallErrorType,
      })

      updatePollingState(this.txId, {
        flowStatus: overallErrorType,
        currentChain: undefined,
        error: {
          type: overallErrorType,
          message: overallErrorMessage,
          occurredAt: overallErrorOccurredAt,
        },
      })
      
      // Map polling error types to top-level status
      let topLevelStatus: StoredTransaction['status']
      if (overallErrorType === 'user_action_required') {
        topLevelStatus = 'broadcasted' // Still in progress, waiting for user
      } else if (overallErrorType === 'tx_error' || overallErrorType === 'polling_error') {
        topLevelStatus = 'error'
      } else {
        topLevelStatus = 'undetermined' // polling_timeout
      }
      
      // Update top-level transaction status to reflect polling state
      // Only update if flowStatusSnapshot is not available (frontend-only polling)
      const tx = transactionStorageService.getTransaction(this.txId)
      if (tx && !tx.flowStatusSnapshot) {
        transactionStorageService.updateTransaction(this.txId, {
          status: topLevelStatus,
        })
      }
      
      return
    }

    // Check if flow is stuck (all chains have status but none are pending or success)
    // This handles cases where some chains errored but flow hasn't been marked as failed
    const allChainsHaveStatus = chainOrder.every((chain) => {
      const chainStatus = state.chainStatus[chain]
      return chainStatus !== undefined && chainStatus.status !== 'pending'
    })

    if (allChainsHaveStatus && !allChainsComplete) {
      // Some chains succeeded, some errored - determine overall status
      const hasUserActionRequired = chainOrder.some(
        (chain) => state.chainStatus[chain]?.status === 'user_action_required',
      )
      const hasTxError = chainOrder.some(
        (chain) => state.chainStatus[chain]?.status === 'tx_error',
      )
      const hasPollingError = chainOrder.some(
        (chain) => state.chainStatus[chain]?.status === 'polling_error',
      )
      const hasTimeout = chainOrder.some(
        (chain) => state.chainStatus[chain]?.status === 'polling_timeout',
      )

      // Priority: user_action_required > tx_error > polling_error > polling_timeout
      let topLevelStatus: StoredTransaction['status'] | undefined
      
      if (hasUserActionRequired) {
        updatePollingState(this.txId, {
          flowStatus: 'user_action_required',
        })
        // User action required - transaction is still in progress, keep as broadcasted
        topLevelStatus = 'broadcasted'
      } else if (hasTxError) {
        updatePollingState(this.txId, {
          flowStatus: 'tx_error',
        })
        topLevelStatus = 'error'
      } else if (hasPollingError) {
        updatePollingState(this.txId, {
          flowStatus: 'polling_error',
        })
        topLevelStatus = 'error'
      } else if (hasTimeout) {
        updatePollingState(this.txId, {
          flowStatus: 'polling_timeout',
        })
        topLevelStatus = 'undetermined'
      }
      
      // Update top-level transaction status to reflect polling state
      // Only update if flowStatusSnapshot is not available (frontend-only polling)
      if (topLevelStatus) {
        const tx = transactionStorageService.getTransaction(this.txId)
        // Only update top-level status if backend status is not available
        // (backend status takes priority per getEffectiveStatus logic)
        if (tx && !tx.flowStatusSnapshot) {
          transactionStorageService.updateTransaction(this.txId, {
            status: topLevelStatus,
          })
        }
      }
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

