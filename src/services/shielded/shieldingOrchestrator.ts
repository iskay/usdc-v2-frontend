/**
 * Shielding orchestrator - high-level function that combines build → sign → broadcast flow.
 */

import { logger } from '@/utils/logger'
import { buildShieldingTx, type BuildShieldingTxParams, type ShieldingTxData } from '@/services/tx/txBuilder'
import { submitNamadaTx } from '@/services/tx/txSubmitter'
import type { TrackedTransaction } from '@/types/tx'
import {
  stubCreateShieldingTransaction,
  stubUpdateShieldingTransaction,
  stubStoreShieldingTransactionMetadata,
} from './shieldingTxTracker'
import { triggerShieldedBalanceRefresh } from '@/services/balance/shieldedBalanceService'

export type ShieldingPhase = 'building' | 'signing' | 'submitting' | 'submitted'

export interface ShieldingOrchestratorOptions {
  onPhase?: (phase: ShieldingPhase) => void
  onProgress?: (progress: { phase: ShieldingPhase; message?: string }) => void
}

export interface ShieldingResult {
  txId: string
  txHash: string
  transaction: TrackedTransaction
}

/**
 * Execute full shielding flow: build → sign → broadcast.
 *
 * @param params - Shielding transaction parameters
 * @param options - Optional callbacks for phase updates
 * @returns Transaction hash and transaction details
 */
export async function executeShielding(
  params: BuildShieldingTxParams,
  options: ShieldingOrchestratorOptions = {},
): Promise<ShieldingResult> {
  const { onPhase, onProgress } = options

  logger.info('[ShieldingOrchestrator] 🛡️  Starting shielding flow', {
    transparent: params.transparent.slice(0, 12) + '...',
    shielded: params.shielded.slice(0, 12) + '...',
    amountInBase: params.amountInBase,
  })

  let transaction: TrackedTransaction | null = null

  try {
    // Phase 1: Building
    logger.info('[ShieldingOrchestrator] 📦 Phase: Building transaction')
    onPhase?.('building')
    onProgress?.({ phase: 'building', message: 'Building shielding transaction...' })

    transaction = await buildShieldingTx(params)

    logger.info('[ShieldingOrchestrator] ✅ Transaction built', {
      txId: transaction.id,
      status: transaction.status,
    })

    // Stub: Create transaction record
    stubCreateShieldingTransaction(transaction)

    // Phase 2: Signing
    logger.info('[ShieldingOrchestrator] ✍️  Phase: Signing transaction')
    onPhase?.('signing')
    onProgress?.({ phase: 'signing', message: 'Waiting for approval...' })

    // Submit transaction (this will sign first, then broadcast)
    // The signing happens inside submitNamadaTx and waits for user confirmation
    // We'll update to 'submitting' phase after signing completes
    const txHashResult = await submitNamadaTx(transaction, {
      onSigningComplete: () => {
        // Phase 3: Submitting (only after signing is complete)
        logger.info('[ShieldingOrchestrator] 📡 Phase: Submitting transaction')
        onPhase?.('submitting')
        onProgress?.({ phase: 'submitting', message: 'Submitting transaction...' })
      },
    })
    // Extract hash string from result (can be string or object with hash property)
    const txHash = typeof txHashResult === 'string' ? txHashResult : txHashResult.hash

    // Phase 4: Submitted
    logger.info('[ShieldingOrchestrator] ✅ Phase: Transaction submitted', {
      txHash: txHash.slice(0, 16) + '...',
    })
    onPhase?.('submitted')
    onProgress?.({ phase: 'submitted', message: 'Transaction submitted successfully' })

    if (!transaction) {
      throw new Error('Transaction object is null after submission')
    }

    // Update transaction with hash
    const updatedTransaction: TrackedTransaction & { shieldingData?: ShieldingTxData } = {
      ...transaction,
      hash: txHash,
      status: 'broadcasted',
    }

    logger.info('[ShieldingOrchestrator] ✅ Shielding flow completed successfully', {
      txId: updatedTransaction.id,
      txHash: txHash.slice(0, 16) + '...',
      txHashDisplay: `${txHash.slice(0, 8)}...${txHash.slice(-8)}`,
    })

    // Stub: Update transaction record and store metadata
    stubUpdateShieldingTransaction(updatedTransaction.id, txHash)
    if (updatedTransaction.shieldingData) {
      stubStoreShieldingTransactionMetadata(
        updatedTransaction.id,
        txHash,
        updatedTransaction.shieldingData,
      )
    }

    // Trigger balance refresh after successful shield
    try {
      logger.debug('[ShieldingOrchestrator] Triggering shielded balance refresh...')
      await triggerShieldedBalanceRefresh({
        chainId: updatedTransaction.shieldingData?.chainId,
      })
      logger.info('[ShieldingOrchestrator] ✅ Shielded balance refresh triggered')
    } catch (error) {
      // Don't fail the whole operation if balance refresh fails
      logger.warn('[ShieldingOrchestrator] Failed to trigger balance refresh', {
        error: error instanceof Error ? error.message : String(error),
      })
    }

    return {
      txId: updatedTransaction.id,
      txHash,
      transaction: updatedTransaction,
    }
  } catch (error) {
    logger.error('[ShieldingOrchestrator] ❌ Shielding flow failed', {
      txId: transaction?.id,
      error: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
    })

    // Update transaction status if we have one
    if (transaction) {
      transaction.status = 'error'
      transaction.errorMessage = error instanceof Error ? error.message : String(error)
    }

    throw error
  }
}

