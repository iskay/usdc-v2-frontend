/**
 * Stub transaction tracking for shielding transactions.
 * 
 * NOTE: These are placeholder functions that currently only log transaction events.
 * They are kept for API compatibility and will be integrated with the unified transaction
 * tracking system in the future (see Task 1.3: Unified Transaction Storage Service).
 * 
 * Shielding transactions are separate from deposit/payment flows and use a different
 * tracking mechanism. These stubs ensure the shielding orchestrator continues to work
 * while we build out the unified transaction tracking system.
 */

import { logger } from '@/utils/logger'
import type { TrackedTransaction } from '@/types/tx'
import type { ShieldingTxData } from '@/services/tx/txBuilder'

/**
 * Stub: Create transaction record after successful build.
 * 
 * @deprecated This is a stub function. Will be replaced by unified transaction storage service.
 * Currently only logs the transaction creation. The transaction is already tracked in
 * the TrackedTransaction object passed to the shielding orchestrator.
 */
export function stubCreateShieldingTransaction(
  transaction: TrackedTransaction & { shieldingData?: ShieldingTxData },
): void {
  logger.debug('[ShieldingTxTracker] Stub: Creating shielding transaction record', {
    txId: transaction.id,
    transparent: transaction.shieldingData?.transparent.slice(0, 12) + '...',
    shielded: transaction.shieldingData?.shielded.slice(0, 12) + '...',
    amountInBase: transaction.shieldingData?.amountInBase,
    status: transaction.status,
  })

  // NOTE: This will be replaced by unified transaction storage service in future
  // For now, we just log the transaction creation
  // The transaction is already tracked in the TrackedTransaction object
}

/**
 * Stub: Update transaction record after broadcast.
 * 
 * @deprecated This is a stub function. Will be replaced by unified transaction storage service.
 * Currently only logs the transaction update. The transaction hash is already stored
 * in the TrackedTransaction object.
 */
export function stubUpdateShieldingTransaction(
  txId: string,
  txHash: string,
  metadata?: Record<string, unknown>,
): void {
  logger.debug('[ShieldingTxTracker] Stub: Updating shielding transaction record', {
    txId,
    txHash: txHash.slice(0, 16) + '...',
    txHashDisplay: `${txHash.slice(0, 8)}...${txHash.slice(-8)}`,
    metadata,
  })

  // NOTE: This will be replaced by unified transaction storage service in future
  // For now, we just log the transaction update
  // The transaction hash is already stored in the TrackedTransaction object
}

/**
 * Stub: Store transaction hash and metadata for future implementation.
 * 
 * @deprecated This is a stub function. Will be replaced by unified transaction storage service.
 * Currently only logs the metadata. The metadata is already available in the
 * TrackedTransaction.shieldingData property.
 */
export function stubStoreShieldingTransactionMetadata(
  txId: string,
  txHash: string,
  shieldingData: ShieldingTxData,
): void {
  logger.debug('[ShieldingTxTracker] Stub: Storing shielding transaction metadata', {
    txId,
    txHash: txHash.slice(0, 16) + '...',
    transparent: shieldingData.transparent.slice(0, 12) + '...',
    shielded: shieldingData.shielded.slice(0, 12) + '...',
    amountInBase: shieldingData.amountInBase,
    tokenAddress: shieldingData.tokenAddress.slice(0, 12) + '...',
    gasToken: shieldingData.gasToken.slice(0, 12) + '...',
    chainId: shieldingData.chainId,
  })

  // NOTE: This will be replaced by unified transaction storage service in future
  // For now, we just log the metadata
  // The metadata is already available in the TrackedTransaction.shieldingData
}

