/**
 * Deposit service for building, signing, broadcasting, and tracking deposit transactions.
 * Initially stubbed, will be extended with real implementations.
 */

import { buildDepositTx } from '@/services/tx/txBuilder'
import { submitEvmTx } from '@/services/tx/txSubmitter'
import { saveItem, loadItem } from '@/services/storage/localStore'
import { logger } from '@/utils/logger'
import { flowInitiationService } from '@/services/flow/flowInitiationService'
import { getDefaultNamadaChainKey } from '@/config/chains'
import { fetchTendermintChainsConfig } from '@/services/config/tendermintChainConfigService'
import { transactionStorageService, type StoredTransaction } from '@/services/tx/transactionStorageService'
import { jotaiStore } from '@/store/jotaiStore'
import { frontendOnlyModeAtom } from '@/atoms/appAtom'
import BigNumber from 'bignumber.js'
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
  senderAddress?: string // EVM wallet address that initiated the deposit
  feeBreakdown?: {
    approveNative: string
    burnNative: string
    totalNative: string
    nativeSymbol: string
    approvalNeeded?: boolean
    approveUsd?: number
    burnUsd?: number
    totalUsd?: number
    nobleRegUsd: number
  }
  isLoadingFee?: boolean
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

  // Get destination chain from tendermint config
  let destinationChain: string
  try {
    const tendermintConfig = await fetchTendermintChainsConfig()
    destinationChain = getDefaultNamadaChainKey(tendermintConfig) || 'namada-testnet'
  } catch (error) {
    logger.warn('[DepositService] Failed to load tendermint chains config, using fallback', {
      error: error instanceof Error ? error.message : String(error),
    })
    destinationChain = 'namada-testnet'
  }

  // Use existing txBuilder service
  const tx = await buildDepositTx({
    amount: params.amount,
    sourceChain: params.sourceChain, // Deposits originate from EVM chain
    destinationChain, // Deposits go to Namada (from config)
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
 * Save deposit transaction to unified storage.
 * This replaces the legacy saveDepositMetadata function and uses the unified transaction storage.
 * 
 * @param tx - The transaction to save
 * @param details - Deposit transaction details
 * @param flowId - Optional flow ID from backend
 * @returns The saved transaction
 */
export async function saveDepositTransaction(
  tx: TrackedTransaction,
  details: DepositTransactionDetails,
  flowId?: string,
): Promise<StoredTransaction> {
  // Check if frontend-only mode is enabled
  const isFrontendOnly = jotaiStore.get(frontendOnlyModeAtom)

  logger.info('[DepositService] Saving deposit transaction to unified storage', {
    txId: tx.id,
    txHash: tx.hash,
    flowId,
    isFrontendOnly,
  })

  // Flow metadata should already be in transaction (created during postDepositToBackend)
  // If flowId is provided but flowMetadata is missing, get it from transaction storage
  let flowMetadata = tx.flowMetadata
  // Get existing transaction from storage to preserve clientStages and other fields
  const existingTx = transactionStorageService.getTransaction(tx.id)
  if (flowId && !flowMetadata) {
    // Try to get updated transaction from storage (it should have flowMetadata after backend registration)
    flowMetadata = existingTx?.flowMetadata
  }

  // Create StoredTransaction with deposit details
  // Preserve clientStages from existing transaction (added during submission)
  const storedTx: StoredTransaction = {
    ...tx,
    depositDetails: details,
    flowId: flowId || tx.flowId,
    flowMetadata,
    clientStages: existingTx?.clientStages, // Preserve client stages added during submission
    isFrontendOnly: isFrontendOnly || tx.status === 'undetermined' ? true : undefined,
    // Set status to 'undetermined' if frontend-only mode and no flowId
    status: isFrontendOnly && !flowId ? 'undetermined' : tx.status,
    updatedAt: Date.now(),
  }

  // Save to unified storage
  transactionStorageService.saveTransaction(storedTx)

  logger.debug('[DepositService] Deposit transaction saved successfully', {
    txId: storedTx.id,
    hasFlowId: !!storedTx.flowId,
    hasDepositDetails: !!storedTx.depositDetails,
    isFrontendOnly: storedTx.isFrontendOnly,
  })

  return storedTx
}

/**
 * Save deposit metadata to local storage.
 * 
 * @deprecated This function uses legacy storage format. Use saveDepositTransaction() instead.
 * This function creates a separate entry with a different ID system and will be removed.
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

  console.debug('[DepositService] Saved deposit metadata (legacy)', metadata)
}

/**
 * Post deposit transaction to backend API for flow tracking.
 * Registers the flow with backend after EVM burn transaction is broadcast.
 * Creates flowMetadata in transaction if it doesn't exist.
 * 
 * @param txHash - The EVM burn transaction hash
 * @param details - Deposit transaction details
 * @param tx - The full transaction object (for additional metadata)
 * @returns Backend flowId if registration successful, undefined if frontend-only mode or registration failed
 */
export async function postDepositToBackend(
  txHash: string,
  details: DepositTransactionDetails,
  tx?: TrackedTransaction & { depositData?: { nobleForwardingAddress: string; destinationDomain: number; nonce?: string } },
): Promise<string | undefined> {
  // Check if frontend-only mode is enabled
  const isFrontendOnly = jotaiStore.get(frontendOnlyModeAtom)
  if (isFrontendOnly) {
    logger.info('[DepositService] Frontend-only mode enabled, skipping backend registration', {
      txHash: txHash.slice(0, 16) + '...',
    })
    return undefined
  }

  logger.debug('[DepositService] Posting deposit to backend', {
    txHash: txHash.slice(0, 16) + '...',
    chainName: details.chainName,
  })

  try {
    // Get transaction ID - if tx is provided, use its ID, otherwise find by hash
    let txId: string
    if (tx?.id) {
      txId = tx.id
    } else {
      // Find transaction by hash if tx object not provided
      const allTxs = transactionStorageService.getAllTransactions()
      const foundTx = allTxs.find((t) => t.hash === txHash)
      if (!foundTx) {
        throw new Error(`Transaction not found for hash: ${txHash.slice(0, 16)}...`)
      }
      txId = foundTx.id
    }

    // Get transaction to check if flowMetadata already exists
    const storedTx = transactionStorageService.getTransaction(txId)
    let flowMetadata = storedTx?.flowMetadata

    // If flowMetadata doesn't exist, create it and store in transaction
    if (!flowMetadata) {
      const amountInBaseUnits = new BigNumber(details.amount)
        .multipliedBy(1_000_000) // USDC has 6 decimals
        .toFixed(0)
      
      const chainKey = tx?.chain || details.chainName.toLowerCase().replace(/\s+/g, '-')
      flowMetadata = flowInitiationService.createFlowMetadata(
        'deposit',
        chainKey, // Deposit starts on EVM chain
        amountInBaseUnits,
      )
      
      // Update transaction with flowMetadata
      transactionStorageService.updateTransaction(txId, {
        flowMetadata,
      })
    }

    // Get destination chain from tendermint config (deposits always go to Namada)
    let destinationChainKey: string
    try {
      const tendermintConfig = await fetchTendermintChainsConfig()
      destinationChainKey = getDefaultNamadaChainKey(tendermintConfig) || 'namada-testnet'
    } catch (error) {
      logger.warn('[DepositService] Failed to load tendermint chains config, using fallback', {
        error: error instanceof Error ? error.message : String(error),
      })
      destinationChainKey = 'namada-testnet'
    }

    // Register flow with backend using transaction ID
    const flowId = await flowInitiationService.registerWithBackend(
      txId,
      txHash,
      {
        destinationAddress: details.destinationAddress,
        destinationChain: destinationChainKey, // Use Namada chain key, not source chain
        fee: details.fee,
        total: details.total,
        nobleForwardingAddress: tx?.depositData?.nobleForwardingAddress,
        destinationDomain: tx?.depositData?.destinationDomain,
        nonce: tx?.depositData?.nonce,
      },
    )

    logger.debug('[DepositService] Deposit flow registered with backend', {
      txId,
      localId: flowMetadata.localId,
      flowId,
      txHash: txHash.slice(0, 16) + '...',
    })

    return flowId
  } catch (error) {
    logger.error('[DepositService] Failed to post deposit to backend', {
      error: error instanceof Error ? error.message : String(error),
      txHash: txHash.slice(0, 16) + '...',
    })
    // Don't throw - flow registration failure shouldn't block deposit
    return undefined
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

