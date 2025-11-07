/**
 * Deposit service for building, signing, broadcasting, and tracking deposit transactions.
 * Initially stubbed, will be extended with real implementations.
 */

import { buildDepositTx } from '@/services/tx/txBuilder'
import { submitEvmTx } from '@/services/tx/txSubmitter'
import { saveItem, loadItem } from '@/services/storage/localStore'
import { logger } from '@/utils/logger'
// TODO: Import axios and env when implementing real backend posting
// import axios from 'axios'
// import { env } from '@/config/env'
import type { TrackedTransaction } from '@/types/tx'

export interface DepositParams {
  amount: string
  destinationAddress: string
  sourceChain: string
}

export interface DepositTransactionDetails {
  amount: string
  fee: string
  total: string
  destinationAddress: string
  chainName: string
}

export interface DepositMetadata {
  txId: string
  txHash?: string
  details: DepositTransactionDetails
  timestamp: number
  status: 'pending' | 'submitted' | 'confirmed' | 'failed'
}

const DEPOSIT_STORAGE_KEY = 'deposit-transactions'

/**
 * Build a deposit transaction.
 * Currently stubbed, will use real transaction builder once available.
 * 
 * @param params - Deposit parameters
 * @returns Built transaction
 */
export async function buildDepositTransaction(
  params: DepositParams
): Promise<TrackedTransaction> {
  logger.info('[DepositService] 🏗️  Building deposit transaction', {
    amount: params.amount,
    sourceChain: params.sourceChain,
    destinationAddress: params.destinationAddress,
  })

  // Use existing txBuilder service
  const tx = await buildDepositTx({
    amount: params.amount,
    sourceChain: params.sourceChain, // Deposits originate from EVM chain
    destinationChain: 'namada', // Deposits go to Namada
    recipient: params.destinationAddress,
  })

  logger.info('[DepositService] ✅ Deposit transaction built', {
    txId: tx.id,
    chain: tx.chain,
    hasDepositData: !!tx.depositData,
  })

  return tx
}

/**
 * Sign a deposit transaction.
 * Note: Signing is handled automatically by submitEvmTx via MetaMask.
 * This function is kept for API compatibility but just updates the status.
 * 
 * @param tx - The transaction to sign
 * @returns Transaction with signing status
 */
export async function signDepositTransaction(
  tx: TrackedTransaction
): Promise<TrackedTransaction> {
  console.debug('[DepositService] Signing deposit transaction', tx.id)

  // Signing is handled in submitEvmTx via MetaMask
  // Just update status for API compatibility
  return {
    ...tx,
    status: 'signing',
  }
}

/**
 * Broadcast a deposit transaction.
 * Currently stubbed, will use real transaction submitter once available.
 * 
 * @param tx - The signed transaction to broadcast
 * @returns Transaction hash
 */
export async function broadcastDepositTransaction(
  tx: TrackedTransaction
): Promise<string> {
  logger.info('[DepositService] 📡 Broadcasting deposit transaction', {
    txId: tx.id,
    chain: tx.chain,
    direction: tx.direction,
  })

  // Use existing txSubmitter service
  const txHash = await submitEvmTx(tx)

  logger.info('[DepositService] ✅ Deposit transaction broadcasted', {
    txId: tx.id,
    txHash,
  })

  return txHash
}

/**
 * Save deposit metadata to local storage.
 * 
 * @param txHash - The transaction hash
 * @param details - Deposit transaction details
 */
export async function saveDepositMetadata(
  txHash: string,
  details: DepositTransactionDetails
): Promise<void> {
  const metadata: DepositMetadata = {
    txId: crypto.randomUUID(),
    txHash,
    details,
    timestamp: Date.now(),
    status: 'submitted',
  }

  // Load existing deposits
  const existingDeposits = loadItem<DepositMetadata[]>(DEPOSIT_STORAGE_KEY) ?? []

  // Add new deposit
  const updatedDeposits = [metadata, ...existingDeposits]

  // Save back to storage
  saveItem(DEPOSIT_STORAGE_KEY, updatedDeposits)

  console.debug('[DepositService] Saved deposit metadata', metadata)
}

/**
 * Post deposit transaction to backend API for status tracking.
 * Currently stubbed - logs the payload structure for future implementation.
 * 
 * @param txHash - The transaction hash
 * @param details - Deposit transaction details
 * @param tx - The full transaction object (for additional metadata)
 */
export async function postDepositToBackend(
  txHash: string,
  details: DepositTransactionDetails,
  tx?: TrackedTransaction & { depositData?: { nobleForwardingAddress: string; destinationDomain: number; nonce?: string } }
): Promise<void> {
  console.debug('[DepositService] Posting deposit to backend', txHash)

  try {
    // Build complete payload with all transaction details needed for backend tracking
    const payload = {
      txHash,
      amount: details.amount,
      fee: details.fee,
      total: details.total,
      destinationAddress: details.destinationAddress,
      chainName: details.chainName,
      chainKey: tx?.chain || details.chainName.toLowerCase().replace(/\s+/g, '-'),
      nobleForwardingAddress: tx?.depositData?.nobleForwardingAddress,
      destinationDomain: tx?.depositData?.destinationDomain,
      nonce: tx?.depositData?.nonce,
      timestamp: Date.now(),
      status: 'submitted' as const,
    }

    // Stubbed implementation - log the payload for debugging
    logger.info('[DepositService] 📨 Backend notification payload (stubbed):', payload)

    // TODO: Replace with actual backend endpoint when ready
    // Example implementation:
    // const backendUrl = env.backendUrl()
    // if (!backendUrl) {
    //   console.warn('[DepositService] Backend URL not configured, skipping notification')
    //   return
    // }
    // 
    // try {
    //   const response = await fetch(`${backendUrl}/api/deposits`, {
    //     method: 'POST',
    //     headers: {
    //       'Content-Type': 'application/json',
    //     },
    //     body: JSON.stringify(payload),
    //   })
    //   
    //   if (!response.ok) {
    //     throw new Error(`Backend notification failed: ${response.status} ${response.statusText}`)
    //   }
    //   
    //   console.debug('[DepositService] Backend notification successful')
    // } catch (error) {
    //   console.error('[DepositService] Backend notification error:', error)
    //   // Don't throw - backend notification is non-critical
    // }
  } catch (error) {
    console.error('[DepositService] Failed to prepare backend notification:', error)
    // Don't throw - this is non-critical for now
  }
}

/**
 * Get all saved deposit transactions from local storage.
 * 
 * @returns Array of deposit metadata
 */
export function getDepositHistory(): DepositMetadata[] {
  return loadItem<DepositMetadata[]>(DEPOSIT_STORAGE_KEY) ?? []
}

/**
 * Get a specific deposit transaction by hash.
 * 
 * @param txHash - The transaction hash
 * @returns Deposit metadata or undefined if not found
 */
export function getDepositByHash(txHash: string): DepositMetadata | undefined {
  const deposits = getDepositHistory()
  return deposits.find((d) => d.txHash === txHash)
}

