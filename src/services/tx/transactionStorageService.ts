/**
 * Unified Transaction Storage Service
 * 
 * Single source of truth for all transaction data in localStorage.
 * Replaces fragmented storage across DepositMetadata, PaymentMetadata, and in-memory Jotai atom.
 * 
 * This service provides:
 * - CRUD operations for transactions
 * - Helper methods for filtering (in-progress, completed)
 * - localStorage serialization/deserialization
 * - Migration path from legacy storage formats
 */

import type { TrackedTransaction } from '@/types/tx'
import type { FlowStatus } from '@/types/flow'
import type { DepositTransactionDetails } from '@/services/deposit/depositService'
import type { PaymentTransactionDetails } from '@/services/payment/paymentService'
import { saveItem, loadItem, deleteItem } from '@/services/storage/localStore'
import { logger } from '@/utils/logger'

/**
 * Enhanced transaction interface for storage.
 * Extends TrackedTransaction with additional metadata for rich display.
 */
export interface StoredTransaction extends TrackedTransaction {
  /** Cached flow status snapshot for display (updated via polling) */
  flowStatusSnapshot?: FlowStatus
  /** Deposit-specific metadata */
  depositDetails?: DepositTransactionDetails
  /** Payment-specific metadata */
  paymentDetails?: PaymentTransactionDetails
  /** Flag for frontend-only mode (transactions not submitted to backend) */
  isFrontendOnly?: boolean
  /** Last update timestamp (for sorting and filtering) */
  updatedAt: number
}

const STORAGE_KEY = 'unified-transactions'

/**
 * Unified Transaction Storage Service
 * 
 * Singleton service for managing all transaction data in localStorage.
 */
class TransactionStorageService {
  /**
   * Save a transaction to storage.
   * If transaction with same ID exists, it will be updated.
   */
  saveTransaction(tx: StoredTransaction): void {
    try {
      const allTxs = this.getAllTransactions()
      
      // Remove existing transaction with same ID
      const filtered = allTxs.filter((t) => t.id !== tx.id)
      
      // Add updated transaction with current timestamp
      const updatedTx: StoredTransaction = {
        ...tx,
        updatedAt: Date.now(),
      }
      
      const updated = [updatedTx, ...filtered]
      saveItem(STORAGE_KEY, updated)
      
      logger.debug('[TransactionStorageService] Saved transaction', {
        txId: tx.id,
        direction: tx.direction,
        status: tx.status,
        hasFlowId: !!tx.flowId,
      })
    } catch (error) {
      logger.error('[TransactionStorageService] Failed to save transaction', {
        txId: tx.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Get a transaction by ID.
   */
  getTransaction(id: string): StoredTransaction | null {
    try {
      const allTxs = this.getAllTransactions()
      return allTxs.find((tx) => tx.id === id) || null
    } catch (error) {
      logger.error('[TransactionStorageService] Failed to get transaction', {
        id,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  /**
   * Get all transactions, ordered by most recent first (updatedAt descending).
   */
  getAllTransactions(): StoredTransaction[] {
    try {
      const stored = loadItem<StoredTransaction[]>(STORAGE_KEY)
      if (!stored) return []
      
      // Sort by updatedAt descending (most recent first)
      return stored.sort((a, b) => {
        const aTime = a.updatedAt || a.createdAt
        const bTime = b.updatedAt || b.createdAt
        return bTime - aTime
      })
    } catch (error) {
      logger.error('[TransactionStorageService] Failed to load transactions', {
        error: error instanceof Error ? error.message : String(error),
      })
      return []
    }
  }

  /**
   * Update an existing transaction with partial updates.
   */
  updateTransaction(id: string, updates: Partial<StoredTransaction>): void {
    try {
      const tx = this.getTransaction(id)
      if (!tx) {
        logger.warn('[TransactionStorageService] Transaction not found for update', { id })
        return
      }

      const updatedTx: StoredTransaction = {
        ...tx,
        ...updates,
        updatedAt: Date.now(),
      }

      this.saveTransaction(updatedTx)
      
      logger.debug('[TransactionStorageService] Updated transaction', {
        id,
        updates: Object.keys(updates),
      })
    } catch (error) {
      logger.error('[TransactionStorageService] Failed to update transaction', {
        id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Delete a transaction from storage.
   */
  deleteTransaction(id: string): void {
    try {
      const allTxs = this.getAllTransactions()
      const filtered = allTxs.filter((tx) => tx.id !== id)
      saveItem(STORAGE_KEY, filtered)
      
      logger.debug('[TransactionStorageService] Deleted transaction', { id })
    } catch (error) {
      logger.error('[TransactionStorageService] Failed to delete transaction', {
        id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Get all in-progress transactions.
   * In-progress: status is 'submitting' or 'broadcasted' AND flowStatus is 'pending' (or no flowStatus).
   * Note: 'undetermined' status is NOT considered in-progress (it's a final state indicating timeout).
   */
  getInProgressTransactions(): StoredTransaction[] {
    const allTxs = this.getAllTransactions()
    return allTxs.filter((tx) => {
      // Exclude final states (including 'undetermined')
      if (tx.status === 'finalized' || tx.status === 'error' || tx.status === 'undetermined') {
        return false
      }
      
      // Check if transaction is in a non-final state
      const isInProgressStatus = 
        tx.status === 'submitting' || 
        tx.status === 'broadcasted' ||
        tx.status === 'building' ||
        tx.status === 'signing'
      
      if (!isInProgressStatus) return false
      
      // If we have flow status, check if flow is still pending
      if (tx.flowStatusSnapshot) {
        return tx.flowStatusSnapshot.status === 'pending'
      }
      
      // If no flow status but status is in-progress, include it
      return true
    })
  }

  /**
   * Get completed transactions (success, error, or undetermined).
   * Optionally limit the number of results.
   */
  getCompletedTransactions(limit?: number): StoredTransaction[] {
    const allTxs = this.getAllTransactions()
    const completed = allTxs.filter((tx) => {
      // Check if transaction is in a final state (including 'undetermined')
      const isFinalStatus = tx.status === 'finalized' || tx.status === 'error' || tx.status === 'undetermined'
      
      if (isFinalStatus) return true
      
      // Also check flow status if available
      if (tx.flowStatusSnapshot) {
        return tx.flowStatusSnapshot.status === 'completed' || tx.flowStatusSnapshot.status === 'failed'
      }
      
      return false
    })
    
    return limit ? completed.slice(0, limit) : completed
  }

  /**
   * Clear all transactions from storage.
   * Use with caution - this will delete all transaction history.
   */
  clearAll(): void {
    try {
      deleteItem(STORAGE_KEY)
      logger.info('[TransactionStorageService] Cleared all transactions')
    } catch (error) {
      logger.error('[TransactionStorageService] Failed to clear transactions', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Get transaction count.
   */
  getCount(): number {
    return this.getAllTransactions().length
  }
}

// Export singleton instance
export const transactionStorageService = new TransactionStorageService()

