/**
 * Deposit service for building, signing, broadcasting, and tracking deposit transactions.
 * Initially stubbed, will be extended with real implementations.
 */

import { buildDepositTx } from '@/services/tx/txBuilder'
import { submitEvmTx } from '@/services/tx/txSubmitter'
import { saveItem, loadItem } from '@/services/storage/localStore'
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
  console.debug('[DepositService] Building deposit transaction', params)

  // Use existing txBuilder service
  const tx = await buildDepositTx({
    amount: params.amount,
    sourceChain: params.sourceChain, // Deposits originate from EVM chain
    destinationChain: 'namada', // Deposits go to Namada
    recipient: params.destinationAddress,
  })

  return tx
}

/**
 * Sign a deposit transaction.
 * Currently stubbed, will use MetaMask signing once available.
 * 
 * @param tx - The transaction to sign
 * @returns Signed transaction (same structure for now)
 */
export async function signDepositTransaction(
  tx: TrackedTransaction
): Promise<TrackedTransaction> {
  console.debug('[DepositService] Signing deposit transaction', tx.id)

  // TODO: Use MetaMask to sign the transaction
  // For now, just return the transaction as-is
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
  console.debug('[DepositService] Broadcasting deposit transaction', tx.id)

  // Use existing txSubmitter service
  const txHash = await submitEvmTx(tx)

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
 * Post deposit transaction to backend API.
 * Currently stubbed, will use real backend endpoint once available.
 * 
 * @param txHash - The transaction hash
 * @param details - Deposit transaction details
 */
export async function postDepositToBackend(
  txHash: string,
  details: DepositTransactionDetails
): Promise<void> {
  console.debug('[DepositService] Posting deposit to backend', txHash)

  try {
    // TODO: Replace with actual backend endpoint
    // Example: await axios.post(`${env.backendUrl()}/api/deposits`, payload)
    
    // For now, just log the request
    const payload = {
      txHash,
      amount: details.amount,
      fee: details.fee,
      total: details.total,
      destinationAddress: details.destinationAddress,
      chainName: details.chainName,
      timestamp: Date.now(),
    }

    console.debug('[DepositService] Would post to backend:', payload)

    // Stubbed: In real implementation, this would be:
    // const backendUrl = env.backendUrl() ?? 'http://localhost:8787'
    // await axios.post(`${backendUrl}/api/deposits`, payload)
  } catch (error) {
    console.error('[DepositService] Failed to post deposit to backend:', error)
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

