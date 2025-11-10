/**
 * Payment service for building, signing, broadcasting, and tracking payment transactions.
 * Handles IBC unshielding transactions with orbiter payload for cross-chain payments.
 */

import { submitNamadaTx } from '@/services/tx/txSubmitter'
import { saveItem, loadItem } from '@/services/storage/localStore'
import { buildOrbiterCctpMemo, verifyOrbiterPayload } from './orbiterPayloadService'
import { buildIbcTransaction } from './ibcService'
import { fetchEvmChainsConfig } from '@/services/config/chainConfigService'
import { findChainByKey } from '@/config/chains'
import { fetchNamadaAccounts, type NamadaKeychainAccount } from '@/services/wallet/namadaKeychain'
import { getNamadaSdk } from '@/services/namada/namadaSdkService'
import { estimateGasForToken } from '@/services/namada/namadaFeeEstimatorService'
import { getUSDCAddressFromRegistry } from '@/services/namada/namadaBalanceService'
import { env } from '@/config/env'
import { logger } from '@/utils/logger'
import BigNumber from 'bignumber.js'
import type { TrackedTransaction } from '@/types/tx'
import type { IbcParams, PaymentTransactionData, ChainSettings } from '@/types/shielded'

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
  feeToken?: 'USDC' | 'NAM'
  isLoadingFee?: boolean
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
 * Get shielded account (pseudoExtendedKey) from Namada extension.
 * This is used for gas spending in IBC transfers.
 *
 * @param transparentAddress - The transparent address to find the shielded account for
 * @param shieldedAddress - The shielded payment address (optional, for optimization)
 * @returns The pseudoExtendedKey or null if not found
 */
export async function getShieldedAccount(
  transparentAddress: string,
  shieldedAddress?: string,
): Promise<string | null> {
  try {
    const accounts = await fetchNamadaAccounts()
    if (!Array.isArray(accounts)) {
      logger.warn('[PaymentService] Accounts is not an array')
      return null
    }

    // If shielded address is provided, try to find account by that address first
    if (shieldedAddress) {
      const shieldedAccount = accounts.find(
        (a: NamadaKeychainAccount) =>
          a?.address === shieldedAddress &&
          typeof a?.pseudoExtendedKey === 'string' &&
          a.pseudoExtendedKey.length > 0,
      )
      if (shieldedAccount?.pseudoExtendedKey) {
        logger.debug('[PaymentService] Found shielded account by address', {
          transparent: transparentAddress.slice(0, 12) + '...',
          shielded: shieldedAddress.slice(0, 12) + '...',
        })
        return shieldedAccount.pseudoExtendedKey
      }
    }

    // Find the parent account (transparent)
    const parent = accounts.find((a: NamadaKeychainAccount) => a?.address === transparentAddress)
    if (!parent?.id) {
      logger.debug('[PaymentService] Parent account not found for transparent address', {
        transparent: transparentAddress.slice(0, 12) + '...',
      })
      return null
    }

    // Find the child account with pseudoExtendedKey (shielded account for gas spending)
    // Note: parentId may not be in the type definition but exists at runtime
    const shieldedAccount = accounts.find(
      (a: NamadaKeychainAccount & { parentId?: string }) =>
        a?.parentId === (parent as NamadaKeychainAccount & { id?: string })?.id &&
        typeof a?.pseudoExtendedKey === 'string' &&
        a.pseudoExtendedKey.length > 0,
    )

    if (shieldedAccount?.pseudoExtendedKey) {
      logger.debug('[PaymentService] Found shielded account with pseudoExtendedKey', {
        transparent: transparentAddress.slice(0, 12) + '...',
        hasPseudoExtendedKey: true,
      })
      return shieldedAccount.pseudoExtendedKey
    }

    logger.debug('[PaymentService] No shielded account with pseudoExtendedKey found', {
      transparent: transparentAddress.slice(0, 12) + '...',
    })
    return null
  } catch (error) {
    logger.warn('[PaymentService] Failed to get shielded account from extension', {
      error: error instanceof Error ? error.message : String(error),
      transparent: transparentAddress.slice(0, 12) + '...',
    })
    return null
  }
}

/**
 * Create disposable signer for wrapper transaction and refund target.
 * The same address is used for both purposes.
 *
 * @param transparentAddress - The transparent address (fallback if disposable signer creation fails)
 * @returns Object with accountPublicKey, ownerAddress, and refundTarget
 */
export async function createDisposableSigner(transparentAddress: string): Promise<{
  accountPublicKey: string
  ownerAddress: string
  refundTarget: string | undefined
}> {
  let accountPublicKey = ''
  let ownerAddress = transparentAddress
  let refundTarget: string | undefined

  try {
    const namada = (window as any).namada
    if (!namada?.getSigner) {
      logger.warn('[PaymentService] Namada extension signer not available, using transparent address')
      // Fallback to querying public key from RPC
      const sdk = await getNamadaSdk()
      accountPublicKey = (await (sdk as any).rpc.queryPublicKey(transparentAddress)) || ''
      return { accountPublicKey, ownerAddress, refundTarget }
    }

    const signer = await namada.getSigner()
    const disposableWrapper = await signer?.genDisposableKeypair?.()

    if (disposableWrapper?.publicKey && disposableWrapper?.address) {
      accountPublicKey = disposableWrapper.publicKey
      ownerAddress = disposableWrapper.address
      // Use the same address for refund target to ensure we can access refunded funds
      refundTarget = disposableWrapper.address
      logger.debug('[PaymentService] Created disposable signer', {
        ownerAddress: ownerAddress.slice(0, 12) + '...',
        publicKey: accountPublicKey.slice(0, 16) + '...',
      })
    } else {
      // Fallback to querying public key from RPC
      const sdk = await getNamadaSdk()
      accountPublicKey = (await (sdk as any).rpc.queryPublicKey(transparentAddress)) || ''
      logger.debug('[PaymentService] Disposable signer creation failed, using transparent address', {
        transparent: transparentAddress.slice(0, 12) + '...',
      })
    }
  } catch (error) {
    logger.warn('[PaymentService] Failed to create disposable signer, using transparent address', {
      error: error instanceof Error ? error.message : String(error),
      transparent: transparentAddress.slice(0, 12) + '...',
    })
    // Fallback to querying public key from RPC
    try {
      const sdk = await getNamadaSdk()
      accountPublicKey = (await (sdk as any).rpc.queryPublicKey(transparentAddress)) || ''
    } catch (rpcError) {
      logger.error('[PaymentService] Failed to query public key from RPC', {
        error: rpcError instanceof Error ? rpcError.message : String(rpcError),
      })
    }
  }

  return { accountPublicKey, ownerAddress, refundTarget }
}

/**
 * Persist disposable signer to Namada extension.
 * This is needed before signing so the extension can pay fees from it.
 *
 * @param ownerAddress - The disposable signer address to persist
 */
export async function persistDisposableSigner(ownerAddress: string): Promise<void> {
  try {
    const namada = (window as any).namada
    if (!namada?.getSigner) {
      logger.warn('[PaymentService] Namada extension signer not available for persistence')
      return
    }

    const signer = await namada.getSigner()
    if (signer && typeof signer.persistDisposableKeypair === 'function') {
      await signer.persistDisposableKeypair(ownerAddress)
      logger.debug('[PaymentService] Persisted disposable signer', {
        ownerAddress: ownerAddress.slice(0, 12) + '...',
      })
    }
  } catch (error) {
    logger.warn('[PaymentService] Failed to persist disposable signer', {
      error: error instanceof Error ? error.message : String(error),
      ownerAddress: ownerAddress.slice(0, 12) + '...',
    })
    // Don't throw - this is non-critical, transaction can still proceed
  }
}

/**
 * Clear disposable signer from Namada extension.
 * This should be called after transaction completion (success or failure).
 *
 * @param address - The disposable signer address to clear
 */
export async function clearDisposableSigner(address: string): Promise<void> {
  try {
    const namada = (window as any).namada
    if (!namada?.getSigner) {
      logger.warn('[PaymentService] Namada extension signer not available for clearing')
      return
    }

    const signer = await namada.getSigner()
    if (signer && typeof signer.clearDisposableKeypair === 'function') {
      await signer.clearDisposableKeypair(address)
      logger.debug('[PaymentService] Cleared disposable signer', {
        address: address.slice(0, 12) + '...',
      })
    }
  } catch (error) {
    logger.warn('[PaymentService] Failed to clear disposable signer', {
      error: error instanceof Error ? error.message : String(error),
      address: address.slice(0, 12) + '...',
    })
    // Don't throw - this is non-critical cleanup
  }
}

/**
 * Prepare payment parameters for building IBC transaction.
 * This orchestrates getting all necessary data (shielded account, disposable signer, gas, etc.)
 */
export async function preparePaymentParams(
  params: PaymentParams & {
    transparentAddress: string
    shieldedAddress?: string
  },
): Promise<{
  ibcParams: IbcParams
  paymentData: PaymentTransactionData
  refundTarget?: string
  disposableSignerAddress?: string
  disposableSignerPublicKey?: string
}> {
  logger.debug('[PaymentService] Preparing payment parameters', {
    amount: params.amount,
    destinationAddress: params.destinationAddress.slice(0, 10) + '...',
    destinationChain: params.destinationChain,
    transparent: params.transparentAddress.slice(0, 12) + '...',
  })

  // Get chain configuration for CCTP domain
  const chainConfig = await fetchEvmChainsConfig()
  const chain = findChainByKey(chainConfig, params.destinationChain)
  if (!chain) {
    throw new Error(`Chain configuration not found for: ${params.destinationChain}`)
  }

  const destinationDomain = chain.cctpDomain
  if (destinationDomain == null) {
    throw new Error(`CCTP domain not configured for chain: ${params.destinationChain}`)
  }

  // Get USDC token address
  const usdcToken = await getUSDCAddressFromRegistry()
  if (!usdcToken) {
    throw new Error('USDC token address not found. Please configure VITE_USDC_TOKEN_ADDRESS')
  }

  // Convert amount to base units (USDC has 6 decimals)
  const amountInBase = new BigNumber(params.amount).multipliedBy(1e6)
  if (!amountInBase.isFinite() || amountInBase.isLessThanOrEqualTo(0)) {
    throw new Error('Invalid amount')
  }

  // Get chain ID
  const chainId = env.namadaChainId()
  if (!chainId) {
    throw new Error('Namada chain ID not configured')
  }

  // Get shielded account (pseudoExtendedKey) for gas spending
  const pseudoExtendedKey = await getShieldedAccount(params.transparentAddress, params.shieldedAddress)
  if (!pseudoExtendedKey) {
    throw new Error('No shielded account with pseudoExtendedKey found. Please ensure you have a shielded account in your Namada Keychain.')
  }

  // Create disposable signer for wrapper and refund target
  const { accountPublicKey, ownerAddress, refundTarget } = await createDisposableSigner(
    params.transparentAddress,
  )

  // Build orbiter memo payload
  const orbiterMemoParams = {
    destinationDomain,
    evmRecipientHex20: params.destinationAddress,
  }
  const orbiterMemo = buildOrbiterCctpMemo(orbiterMemoParams)

  // Sanity check: Verify the orbiter payload was encoded correctly
  logger.info('[PaymentService] Verifying orbiter payload before proceeding...')
  try {
    verifyOrbiterPayload(orbiterMemo, orbiterMemoParams)
    logger.info('[PaymentService] ✅ Orbiter payload verification successful')
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('[PaymentService] ❌ Orbiter payload verification failed - aborting transaction', {
      error: errorMessage,
      destinationDomain,
      destinationAddress: params.destinationAddress.slice(0, 10) + '...',
    })
    throw new Error(`Orbiter payload verification failed: ${errorMessage}. Transaction aborted for safety.`)
  }

  // Estimate gas for IBC transfer
  const gas = await estimateGasForToken(usdcToken, ['IbcTransfer'], '90000')

  const chainSettings: ChainSettings = {
    chainId,
    nativeTokenAddress: gas.gasToken,
  }

  // IBC channel configuration
  const channelId = env.namadaToNobleChannel() || 'channel-27'
  const receiver = env.nobleReceiverAddress() || 'noble15xt7kx5mles58vkkfxvf0lq78sw04jajvfgd4d'

  // Build IBC parameters
  const ibcParams: IbcParams = {
    ownerAddress,
    accountPublicKey,
    source: pseudoExtendedKey, // Use pseudoExtendedKey as source (shielded account)
    receiver,
    tokenAddress: usdcToken,
    amountInBase: amountInBase.toString(),
    gas,
    chain: chainSettings,
    channelId,
    portId: 'transfer',
    memo: orbiterMemo,
    refundTarget,
    gasSpendingKey: pseudoExtendedKey, // Use pseudoExtendedKey for gas spending
  }

  const paymentData: PaymentTransactionData = {
    amount: params.amount,
    destinationAddress: params.destinationAddress,
    destinationChain: params.destinationChain,
    destinationDomain,
    orbiterMemo,
    ibcParams,
    refundTarget,
    disposableSignerAddress: ownerAddress,
    disposableSignerPublicKey: accountPublicKey,
  }

  logger.debug('[PaymentService] Payment parameters prepared', {
    destinationDomain,
    amountInBase: amountInBase.toString(),
    hasPseudoExtendedKey: Boolean(pseudoExtendedKey),
    hasRefundTarget: Boolean(refundTarget),
    channelId,
    receiver,
  })

  return {
    ibcParams,
    paymentData,
    refundTarget,
    disposableSignerAddress: ownerAddress,
    disposableSignerPublicKey: accountPublicKey,
  }
}

/**
 * Build a payment transaction.
 * This builds an IBC transfer transaction with orbiter payload for cross-chain payments.
 *
 * @param params - Payment parameters
 * @returns Built transaction with payment data
 */
export async function buildPaymentTransaction(
  params: PaymentParams & {
    transparentAddress: string
    shieldedAddress?: string
  },
): Promise<TrackedTransaction & { paymentData?: PaymentTransactionData }> {
  logger.info('[PaymentService] Building payment transaction', {
    amount: params.amount,
    destinationAddress: params.destinationAddress.slice(0, 10) + '...',
    destinationChain: params.destinationChain,
    transparent: params.transparentAddress.slice(0, 12) + '...',
  })

  try {
    // Prepare all payment parameters
    const { ibcParams, paymentData } = await preparePaymentParams(params)

    // Build IBC transaction
    logger.info('[PaymentService] Building IBC transfer transaction...')
    const encodedTxData = await buildIbcTransaction(ibcParams)

    logger.info('[PaymentService] Payment transaction built successfully', {
      txCount: encodedTxData.txs.length,
      hasRevealPk: encodedTxData.txs.some((tx) => tx.innerTxHashes.length > 1),
    })

    const txId = crypto.randomUUID()
    return {
      id: txId,
      createdAt: Date.now(),
      chain: ibcParams.chain.chainId,
      direction: 'send',
      status: 'building',
      paymentData: {
        ...paymentData,
        encodedTxData,
      },
    }
  } catch (error) {
    logger.error('[PaymentService] Failed to build payment transaction', {
      params: {
        amount: params.amount,
        destinationAddress: params.destinationAddress.slice(0, 10) + '...',
        destinationChain: params.destinationChain,
      },
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

/**
 * Sign a payment transaction.
 * Note: Actual signing happens in the transaction submitter (submitPaymentTx).
 * This function is kept for API consistency but is a no-op.
 * 
 * @param tx - The transaction to sign
 * @returns Transaction (signing happens during broadcast)
 */
export async function signPaymentTransaction(
  tx: TrackedTransaction
): Promise<TrackedTransaction> {
  logger.debug('[PaymentService] Signing payment transaction (no-op, signing happens during broadcast)', {
    txId: tx.id,
  })

  // Signing happens in submitPaymentTx when broadcastPaymentTransaction is called
  // Return transaction as-is for API consistency
  return {
    ...tx,
    status: 'building',
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

  logger.debug('[PaymentService] Saved payment metadata', {
    txId: metadata.txId,
    txHash: metadata.txHash?.slice(0, 16) + '...',
    amount: metadata.details.amount,
    destinationChain: metadata.details.chainName,
  })
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
  logger.debug('[PaymentService] Posting payment to backend', {
    txHash: txHash.slice(0, 16) + '...',
    destinationChain: details.chainName,
  })

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

    logger.debug('[PaymentService] Would post to backend', {
      txHash: payload.txHash.slice(0, 16) + '...',
      amount: payload.amount,
      destinationChain: payload.chainName,
    })

    // Stubbed: In real implementation, this would be:
    // const backendUrl = env.backendUrl() ?? 'http://localhost:8787'
    // await axios.post(`${backendUrl}/api/payments`, payload)
  } catch (error) {
    logger.error('[PaymentService] Failed to post payment to backend', {
      error: error instanceof Error ? error.message : String(error),
      txHash: txHash.slice(0, 16) + '...',
    })
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

