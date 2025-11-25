/**
 * Chain Polling Service
 * 
 * Main service for starting and managing frontend-managed chain polling.
 * Integrates with transaction lifecycle to start polling after broadcast.
 */

import { createFlowOrchestrator, type FlowOrchestratorOptions } from './flowOrchestrator'
import { registerOrchestrator, unregisterOrchestrator } from './orchestratorRegistry'
import { transactionStorageService, type StoredTransaction } from '@/services/tx/transactionStorageService'
import { logger } from '@/utils/logger'
import type { FlowType } from '@/shared/flowStages'
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

    const initialMetadata: Record<string, unknown> = {
      chainKey,
      txHash,
      recipient: tx.depositData?.nobleForwardingAddress || details.destinationAddress,
      amountBaseUnits: amountInBaseUnits,
      usdcAddress: tx.depositData?.usdcAddress,
      messageTransmitterAddress: tx.depositData?.messageTransmitterAddress,
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
    const tx = transactionStorageService.getTransaction(txId)
    if (!tx || !tx.pollingState) {
      logger.warn('[ChainPollingService] Transaction or polling state not found', {
        txId,
      })
      return
    }

    const flowType = tx.pollingState.flowType

    // Create orchestrator (will use existing state)
    const orchestrator = createFlowOrchestrator({
      txId,
      flowType,
      transaction: tx,
    })

    // Cancel flow
    orchestrator.cancelFlow()
  } catch (error) {
    logger.error('[ChainPollingService] Error cancelling polling', {
      txId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Check if frontend polling is enabled
 */
export function isFrontendPollingEnabled(): boolean {
  return ENABLE_FRONTEND_POLLING
}

