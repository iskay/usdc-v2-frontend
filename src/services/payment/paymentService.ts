/**
 * Payment service for building, signing, broadcasting, and tracking payment transactions.
 * Initially stubbed, will be extended with real implementations.
 */

import { buildPaymentTx } from '@/services/tx/txBuilder'
import { submitNamadaTx } from '@/services/tx/txSubmitter'
import { saveItem, loadItem } from '@/services/storage/localStore'
// TODO: Import axios and env when implementing real backend posting
// import axios from 'axios'
// import { env } from '@/config/env'
import type { TrackedTransaction } from '@/types/tx'

export interface PaymentParams {
  amount: string
  destinationAddress: string
  destinationChain: string
}

export interface PaymentTransactionDetails {
  amount: string
  fee: string
  total: string
  destinationAddress: string
  chainName: string
}

export interface PaymentMetadata {
  txId: string
  txHash?: string
  details: PaymentTransactionDetails
  timestamp: number
  status: 'pending' | 'submitted' | 'confirmed' | 'failed'
}

const PAYMENT_STORAGE_KEY = 'payment-transactions'

/**
 * Build a payment transaction.
 * Currently stubbed, will use real transaction builder once available.
 * 
 * @param params - Payment parameters
 * @returns Built transaction
 */
export async function buildPaymentTransaction(
  params: PaymentParams
): Promise<TrackedTransaction> {
  console.debug('[PaymentService] Building payment transaction', params)

  // Use existing txBuilder service
  const tx = await buildPaymentTx({
    amount: params.amount,
    sourceChain: 'namada', // Payments originate from Namada
    destinationChain: params.destinationChain,
    recipient: params.destinationAddress,
  })

  return tx
}

/**
 * Sign a payment transaction.
 * Currently stubbed, will use Namada Keychain signing once available.
 * 
 * @param tx - The transaction to sign
 * @returns Signed transaction (same structure for now)
 */
export async function signPaymentTransaction(
  tx: TrackedTransaction
): Promise<TrackedTransaction> {
  console.debug('[PaymentService] Signing payment transaction', tx.id)

  // TODO: Use Namada Keychain to sign the transaction
  // For now, just return the transaction as-is
  return {
    ...tx,
    status: 'signing',
  }
}

/**
 * Broadcast a payment transaction.
 * Currently stubbed, will use real transaction submitter once available.
 * 
 * @param tx - The signed transaction to broadcast
 * @returns Transaction hash
 */
export async function broadcastPaymentTransaction(
  tx: TrackedTransaction
): Promise<string> {
  console.debug('[PaymentService] Broadcasting payment transaction', tx.id)

  // Use existing txSubmitter service
  const txHash = await submitNamadaTx(tx)

  return txHash
}

/**
 * Save payment metadata to local storage.
 * 
 * @param txHash - The transaction hash
 * @param details - Payment transaction details
 */
export async function savePaymentMetadata(
  txHash: string,
  details: PaymentTransactionDetails
): Promise<void> {
  const metadata: PaymentMetadata = {
    txId: crypto.randomUUID(),
    txHash,
    details,
    timestamp: Date.now(),
    status: 'submitted',
  }

  // Load existing payments
  const existingPayments = loadItem<PaymentMetadata[]>(PAYMENT_STORAGE_KEY) ?? []

  // Add new payment
  const updatedPayments = [metadata, ...existingPayments]

  // Save back to storage
  saveItem(PAYMENT_STORAGE_KEY, updatedPayments)

  console.debug('[PaymentService] Saved payment metadata', metadata)
}

/**
 * Post payment transaction to backend API.
 * Currently stubbed, will use real backend endpoint once available.
 * 
 * @param txHash - The transaction hash
 * @param details - Payment transaction details
 */
export async function postPaymentToBackend(
  txHash: string,
  details: PaymentTransactionDetails
): Promise<void> {
  console.debug('[PaymentService] Posting payment to backend', txHash)

  try {
    // TODO: Replace with actual backend endpoint
    // Example: await axios.post(`${env.backendUrl()}/api/payments`, payload)
    
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

    console.debug('[PaymentService] Would post to backend:', payload)

    // Stubbed: In real implementation, this would be:
    // const backendUrl = env.backendUrl() ?? 'http://localhost:8787'
    // await axios.post(`${backendUrl}/api/payments`, payload)
  } catch (error) {
    console.error('[PaymentService] Failed to post payment to backend:', error)
    // Don't throw - this is non-critical for now
  }
}

/**
 * Get all saved payment transactions from local storage.
 * 
 * @returns Array of payment metadata
 */
export function getPaymentHistory(): PaymentMetadata[] {
  return loadItem<PaymentMetadata[]>(PAYMENT_STORAGE_KEY) ?? []
}

/**
 * Get a specific payment transaction by hash.
 * 
 * @param txHash - The transaction hash
 * @returns Payment metadata or undefined if not found
 */
export function getPaymentByHash(txHash: string): PaymentMetadata | undefined {
  const payments = getPaymentHistory()
  return payments.find((p) => p.txHash === txHash)
}

