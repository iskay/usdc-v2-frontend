/**
 * Stub transaction tracking for shielding transactions.
 * This is a placeholder for future full transaction tracking implementation.
 */

import { logger } from '@/utils/logger'
import type { TrackedTransaction } from '@/types/tx'
import type { ShieldingTxData } from '@/services/tx/txBuilder'

/**
 * Stub: Create transaction record after successful build.
 * In the future, this will integrate with the full transaction tracking system.
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

  // TODO: In the future, integrate with full transaction tracking system
  // For now, we just log the transaction creation
  // The transaction is already tracked in the TrackedTransaction object
}

/**
 * Stub: Update transaction record after broadcast.
 * In the future, this will integrate with the full transaction tracking system.
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

  // TODO: In the future, integrate with full transaction tracking system
  // For now, we just log the transaction update
  // The transaction hash is already stored in the TrackedTransaction object
}

/**
 * Stub: Store transaction hash and metadata for future implementation.
 * This is a placeholder that can be extended when full tracking is implemented.
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

  // TODO: In the future, store this in a database or persistent storage
  // For now, we just log the metadata
  // The metadata is already available in the TrackedTransaction.shieldingData
}

