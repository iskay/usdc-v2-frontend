/**
 * Chain Polling Service
 * 
 * Main service for starting and managing frontend-managed chain polling.
 * Integrates with transaction lifecycle to start polling after broadcast.
 */

import { createFlowOrchestrator, type FlowOrchestratorOptions } from './flowOrchestrator'
import { registerOrchestrator, unregisterOrchestrator, getOrchestrator } from './orchestratorRegistry'
import { transactionStorageService, type StoredTransaction } from '@/services/tx/transactionStorageService'
import { updatePollingState } from './pollingStateManager'
import { logger } from '@/utils/logger'
import type { FlowType } from '@/shared/flowStages'
import type { PollingState } from './types'
import type { DepositTransactionDetails } from '@/services/deposit/depositService'
import type { PaymentTransactionDetails } from '@/services/payment/paymentService'

/**
 * Feature flag: Enable frontend polling
 * Set to true to use frontend-managed polling instead of backend polling
 * 
 * Environment variable: VITE_ENABLE_FRONTEND_POLLING=true
 */
const ENABLE_FRONTEND_POLLING = import.meta.env.VITE_ENABLE_FRONTEND_POLLING === 'true'

/**
 * Start frontend polling for a deposit transaction
 * 
 * @param txId - Transaction ID
 * @param txHash - Transaction hash
 * @param details - Deposit transaction details
 * @param chainKey - EVM chain key (e.g., 'sepolia')
 */
export async function startDepositPolling(
  txId: string,
  txHash: string,
  details: DepositTransactionDetails,
  chainKey: string,
): Promise<void> {
  if (!ENABLE_FRONTEND_POLLING) {
    logger.debug('[ChainPollingService] Frontend polling disabled, skipping', {
      txId,
    })
    return
  }

  logger.info('[ChainPollingService] Starting deposit polling', {
    txId,
    txHash,
    chainKey,
    amount: details.amount,
  })

  try {
    // Get transaction from storage
    const tx = transactionStorageService.getTransaction(txId)
    if (!tx) {
      logger.error('[ChainPollingService] Transaction not found', {
        txId,
      })
      return
    }

    // Build initial metadata for EVM chain
    const amountInBaseUnits = Math.round(parseFloat(details.amount) * 1_000_000).toString()
    const expectedAmountUusdc = `${amountInBaseUnits}uusdc`

    const initialMetadata: Record<string, unknown> = {
      chainKey,
      txHash,
      recipient: tx.depositData?.nobleForwardingAddress || details.destinationAddress,
      amountBaseUnits: amountInBaseUnits,
      usdcAddress: tx.depositData?.usdcAddress,
      messageTransmitterAddress: tx.depositData?.messageTransmitterAddress,
      // Namada-specific metadata (for later chain polling)
      namadaReceiver: details.destinationAddress,
      expectedAmountUusdc,
      forwardingAddress: tx.depositData?.nobleForwardingAddress,
      // For deposit flow, we'll extract CCTP nonce from EVM burn event
      // and pass it to Noble poller
    }

    // Create orchestrator
    const orchestrator = createFlowOrchestrator({
      txId,
      flowType: 'deposit',
      initialMetadata,
      transaction: tx,
    })

    // Register orchestrator for visibility handling
    registerOrchestrator(txId, orchestrator)

    // Start flow (non-blocking)
    orchestrator.startFlow().catch((error) => {
      logger.error('[ChainPollingService] Failed to start deposit polling', {
        txId,
        error: error instanceof Error ? error.message : String(error),
      })
    }).finally(() => {
      // Unregister when flow completes or fails
      unregisterOrchestrator(txId)
    })
  } catch (error) {
    logger.error('[ChainPollingService] Error starting deposit polling', {
      txId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Start frontend polling for a payment transaction
 * 
 * @param txId - Transaction ID
 * @param txHash - Transaction hash (inner tx hash for Namada)
 * @param details - Payment transaction details
 * @param blockHeight - Block height where transaction was included
 * @param chainKey - EVM chain key for destination (e.g., 'sepolia')
 */
export async function startPaymentPolling(
  txId: string,
  txHash: string,
  details: PaymentTransactionDetails,
  blockHeight: string | undefined,
  chainKey: string,
): Promise<void> {
  if (!ENABLE_FRONTEND_POLLING) {
    logger.debug('[ChainPollingService] Frontend polling disabled, skipping', {
      txId,
    })
    return
  }

  logger.info('[ChainPollingService] Starting payment polling', {
    txId,
    txHash,
    blockHeight,
    chainKey,
    amount: details.amount,
  })

  try {
    // Get transaction from storage
    const tx = transactionStorageService.getTransaction(txId)
    if (!tx) {
      logger.error('[ChainPollingService] Transaction not found', {
        txId,
      })
      return
    }

    // Build initial metadata for Namada chain
    const amountInBaseUnits = Math.round(parseFloat(details.amount) * 1_000_000).toString()

    const initialMetadata: Record<string, unknown> = {
      chainKey: 'namada-testnet', // Payment starts on Namada
      namadaIbcTxHash: txHash, // Inner tx hash
      namadaBlockHeight: blockHeight ? Number.parseInt(blockHeight, 10) : undefined,
      recipient: details.destinationAddress,
      amountBaseUnits,
      // For payment flow, Namada poller will extract packet_sequence
      // and pass it to Noble poller, which will extract CCTP nonce
      // and pass it to EVM poller
    }

    // Create orchestrator
    const orchestrator = createFlowOrchestrator({
      txId,
      flowType: 'payment',
      initialMetadata,
      transaction: tx,
    })

    // Register orchestrator for visibility handling
    registerOrchestrator(txId, orchestrator)

    // Start flow (non-blocking)
    orchestrator.startFlow().catch((error) => {
      logger.error('[ChainPollingService] Failed to start payment polling', {
        txId,
        error: error instanceof Error ? error.message : String(error),
      })
    }).finally(() => {
      // Unregister when flow completes or fails
      unregisterOrchestrator(txId)
    })
  } catch (error) {
    logger.error('[ChainPollingService] Error starting payment polling', {
      txId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Resume polling for a transaction
 * 
 * @param txId - Transaction ID
 */
export async function resumePolling(txId: string): Promise<void> {
  if (!ENABLE_FRONTEND_POLLING) {
    logger.debug('[ChainPollingService] Frontend polling disabled, skipping resume', {
      txId,
    })
    return
  }

  logger.info('[ChainPollingService] Resuming polling', {
    txId,
  })

  try {
    const tx = transactionStorageService.getTransaction(txId)
    if (!tx || !tx.pollingState) {
      logger.warn('[ChainPollingService] Transaction or polling state not found', {
        txId,
      })
      return
    }

    const flowType = tx.pollingState.flowType

    // Create orchestrator
    const orchestrator = createFlowOrchestrator({
      txId,
      flowType,
      transaction: tx,
    })

    // Register orchestrator for visibility handling
    registerOrchestrator(txId, orchestrator)

    // Resume flow (non-blocking)
    orchestrator.resumeFlow().catch((error) => {
      logger.error('[ChainPollingService] Failed to resume polling', {
        txId,
        error: error instanceof Error ? error.message : String(error),
      })
    }).finally(() => {
      // Unregister when flow completes or fails
      unregisterOrchestrator(txId)
    })
  } catch (error) {
    logger.error('[ChainPollingService] Error resuming polling', {
      txId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Cancel polling for a transaction
 * 
 * @param txId - Transaction ID
 */
export function cancelPolling(txId: string): void {
  if (!ENABLE_FRONTEND_POLLING) {
    logger.debug('[ChainPollingService] Frontend polling disabled, skipping cancel', {
      txId,
    })
    return
  }

  logger.info('[ChainPollingService] Cancelling polling', {
    txId,
  })

  try {
    // CRITICAL: Get the EXISTING orchestrator from registry, not create a new one
    // Creating a new orchestrator would create a new AbortController, which wouldn't
    // affect the active polling that's using a different controller
    const orchestrator = getOrchestrator(txId)
    
    if (!orchestrator) {
      logger.warn('[ChainPollingService] No active orchestrator found for transaction', {
        txId,
      })
      
      // If no active orchestrator, still update the state to cancelled
      // in case polling was paused or stopped
      const tx = transactionStorageService.getTransaction(txId)
      if (tx?.pollingState) {
        updatePollingState(txId, {
          flowStatus: 'cancelled',
        })
      }
      return
    }

    // Cancel the ACTIVE orchestrator's flow (this will abort the correct AbortController)
    logger.debug('[ChainPollingService] Found active orchestrator, cancelling flow', {
      txId,
      orchestratorExists: !!orchestrator,
    })
    
    orchestrator.cancelFlow()
    
    // Unregister the orchestrator after cancellation
    unregisterOrchestrator(txId)
  } catch (error) {
    logger.error('[ChainPollingService] Error cancelling polling', {
      txId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Retry polling for a transaction (restart from beginning)
 * 
 * @param txId - Transaction ID
 */
export async function retryPolling(txId: string): Promise<void> {
  if (!ENABLE_FRONTEND_POLLING) {
    logger.debug('[ChainPollingService] Frontend polling disabled, skipping retry', {
      txId,
    })
    return
  }

  logger.info('[ChainPollingService] Retrying polling from beginning', {
    txId,
  })

  try {
    const tx = transactionStorageService.getTransaction(txId)
    if (!tx) {
      logger.error('[ChainPollingService] Transaction not found', {
        txId,
      })
      throw new Error('Transaction not found')
    }

    const flowType: FlowType = tx.direction === 'deposit' ? 'deposit' : 'payment'

    // Cancel any existing polling first and unregister orchestrator
    try {
      cancelPolling(txId)
      // Ensure orchestrator is unregistered
      unregisterOrchestrator(txId)
    } catch (error) {
      // Ignore errors from cancel (might not be running)
      logger.debug('[ChainPollingService] Error cancelling existing polling (ignored)', {
        txId,
        error: error instanceof Error ? error.message : String(error),
      })
      // Still try to unregister in case it exists
      unregisterOrchestrator(txId)
    }

    // Reset polling state to start fresh - completely clear all stages, errors, and statuses
    // This ensures we start as if polling for the first time
    const txForReset = transactionStorageService.getTransaction(txId)
    if (!txForReset) {
      throw new Error('Transaction not found')
    }

    // Create a completely fresh polling state
    const resetState: PollingState = {
      flowStatus: 'pending',
      chainStatus: {}, // Clear all chain statuses (including stages, completedStages, errors)
      latestCompletedStage: undefined,
      currentChain: undefined,
      chainParams: {}, // Clear all chain params (will be reinitialized with fresh metadata)
      globalTimeoutAt: undefined,
      error: undefined,
      flowType,
      startedAt: Date.now(),
      lastUpdatedAt: Date.now(),
      lastActiveAt: undefined,
    }

    // Directly update the transaction with the reset state (bypassing merge logic)
    transactionStorageService.updateTransaction(txId, {
      pollingState: resetState,
    })

    logger.info('[ChainPollingService] Reset polling state for retry', {
      txId,
      flowType,
      clearedChainStatuses: Object.keys(txForReset.pollingState?.chainStatus || {}).length,
    })

    // Rebuild initial metadata from transaction
    let initialMetadata: Record<string, unknown>

    if (flowType === 'deposit') {
      if (!tx.depositDetails) {
        throw new Error('Deposit details not found in transaction')
      }

      const details = tx.depositDetails
      const amountInBaseUnits = Math.round(parseFloat(details.amount) * 1_000_000).toString()
      const expectedAmountUusdc = `${amountInBaseUnits}uusdc`

      // Get chain key from transaction
      const chainKey = tx.chain || tx.depositDetails.chainName.toLowerCase().replace(/\s+/g, '-')
      if (!chainKey || chainKey === 'evm') {
        throw new Error('Cannot determine chain key for deposit transaction')
      }

      initialMetadata = {
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

      // Start deposit polling
      await startDepositPolling(txId, tx.hash || '', details, chainKey)
    } else {
      // Payment flow
      if (!tx.paymentDetails) {
        throw new Error('Payment details not found in transaction')
      }

      const details = tx.paymentDetails
      const chainKey = tx.chain || 'namada-testnet'

      // Start payment polling
      await startPaymentPolling(
        txId,
        tx.hash || '',
        details,
        tx.blockHeight,
        chainKey,
      )
    }
  } catch (error) {
    logger.error('[ChainPollingService] Error retrying polling', {
      txId,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

/**
 * Check if frontend polling is enabled
 */
export function isFrontendPollingEnabled(): boolean {
  return ENABLE_FRONTEND_POLLING
}

