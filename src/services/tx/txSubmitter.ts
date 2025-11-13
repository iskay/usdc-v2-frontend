import type { TrackedTransaction } from '@/types/tx'
import { ensureCorrectNetwork } from '@/services/evm/evmNetworkService'
import { depositForBurn } from '@/services/evm/evmContractService'
import type { DepositTxData, ShieldingTxData } from './txBuilder'
import { logger } from '@/utils/logger'
import { getNamadaSdk } from '@/services/namada/namadaSdkService'
import type { EncodedTxData, PaymentTransactionData } from '@/types/shielded'
// import { env } from '@/config/env'
import {
  persistDisposableSigner,
  clearDisposableSigner,
} from '@/services/payment/paymentService'
import { clientStageReporter } from '@/services/flow/clientStageReporter'

export interface DepositTxResult {
  txHash: string
  nonce?: string
}

/**
 * Submits an EVM transaction. For deposit transactions, this handles:
 * - Network verification and switching
 * - USDC approval (if needed)
 * - depositForBurn contract call execution
 * - Transaction receipt waiting
 * - Nonce extraction
 */
export async function submitEvmTx(tx: TrackedTransaction): Promise<string> {
  logger.info('[TxSubmitter] 📤 Submitting EVM transaction', {
    txId: tx.id,
    direction: tx.direction,
    chain: tx.chain,
  })

  if (tx.direction !== 'deposit') {
    throw new Error(`Unsupported transaction direction: ${tx.direction}`)
  }

  // Extract deposit data from transaction
  const depositData = (tx as TrackedTransaction & { depositData?: DepositTxData }).depositData
  if (!depositData) {
    throw new Error('Deposit transaction data not found')
  }

  logger.info('[TxSubmitter] 📋 Deposit transaction data', {
    amount: depositData.amount,
    sourceChain: depositData.sourceChain,
    destinationAddress: depositData.destinationAddress,
    nobleForwardingAddress: depositData.nobleForwardingAddress,
    forwardingAddressBytes32: depositData.forwardingAddressBytes32,
    destinationDomain: depositData.destinationDomain,
  })

  try {
    // Report wallet signing stage
    const flowId = tx.flowId || tx.flowMetadata?.localId || tx.id
    await clientStageReporter.reportWalletStage(flowId, 'wallet_signing', 'evm', undefined, 'pending')

    // Ensure we're on the correct network
    logger.info('[TxSubmitter] 🌐 Ensuring correct network...', {
      sourceChain: depositData.sourceChain,
    })
    await ensureCorrectNetwork(depositData.sourceChain)
    logger.info('[TxSubmitter] ✅ Network verified/switched')

    // Report wallet broadcasting stage
    await clientStageReporter.reportWalletStage(flowId, 'wallet_broadcasting', 'evm', undefined, 'pending')

    // Execute depositForBurn
    logger.info('[TxSubmitter] 🚀 Executing depositForBurn contract call...', {
      chainKey: depositData.sourceChain,
      amountUsdc: depositData.amount,
      forwardingAddressBytes32: depositData.forwardingAddressBytes32,
      destinationDomain: depositData.destinationDomain,
    })
    const result = await depositForBurn({
      chainKey: depositData.sourceChain,
      amountUsdc: depositData.amount,
      forwardingAddressBytes32: depositData.forwardingAddressBytes32,
      destinationDomain: depositData.destinationDomain,
    })

    // Report wallet broadcasted stage
    await clientStageReporter.reportWalletStage(flowId, 'wallet_broadcasted', 'evm', result.txHash, 'confirmed')

    logger.info('[TxSubmitter] ✅ Deposit transaction submitted successfully', {
      txHash: result.txHash,
      nonce: result.nonce || 'not extracted',
      explorerUrl: `https://${depositData.sourceChain.includes('sepolia') ? 'sepolia' : 'basescan'}.org/tx/${result.txHash}`,
    })

    return result.txHash
  } catch (error) {
    console.error('[TxSubmitter] Failed to submit deposit transaction', {
      txId: tx.id,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

/**
 * Sign Namada transaction(s) via Namada Keychain extension.
 */
export async function signNamadaTx(
  encodedTxData: EncodedTxData,
  ownerAddress: string,
): Promise<Uint8Array[]> {
  logger.info('[TxSubmitter] ✍️  Signing Namada transaction', {
    ownerAddress: ownerAddress.slice(0, 12) + '...',
    txCount: encodedTxData.txs.length,
  })

  const namada = (window as any).namada
  if (!namada) {
    throw new Error('Namada Keychain not available. Please install and connect the Namada extension.')
  }

  if (!encodedTxData.txs || encodedTxData.txs.length === 0) {
    throw new Error('No transactions to sign')
  }

  // Get SDK for checksums and deserialization
  const sdk = await getNamadaSdk()

  // Get checksums for transaction validation
  const rawChecksums = (await (sdk as any).rpc.queryChecksums?.()) || {}
  const checksums = Object.fromEntries(
    Object.entries(rawChecksums).map(([path, hash]) => [path, String(hash).toLowerCase()]),
  )

  logger.debug('[TxSubmitter] Checksums retrieved', {
    checksumCount: Object.keys(checksums).length,
  })

  // Ensure extension is connected to the correct Namada chain
  try {
    const desiredChainId = encodedTxData.wrapperTxProps.chainId
    if (namada && typeof namada.isConnected === 'function' && typeof namada.connect === 'function' && desiredChainId) {
      const connected = await namada.isConnected(desiredChainId)
      if (!connected) {
        logger.debug('[TxSubmitter] Connecting Namada extension to chain', { chainId: desiredChainId })
        await namada.connect(desiredChainId)
      }
    }
  } catch (error) {
    logger.warn('[TxSubmitter] Unable to pre-connect Namada extension to chain', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // Prepare transactions for signing (already enriched with innerTxHashes and memos from worker)
  type TxForSign = {
    args: unknown
    hash: string
    bytes: Uint8Array
    signingData: unknown
    innerTxHashes: string[]
    memos: (number[] | null)[]
  }

  const txsForSigning: TxForSign[] = encodedTxData.txs.map((tx) => {
    // Transactions from worker should already be enriched
    if ('innerTxHashes' in tx && 'memos' in tx) {
      return tx as TxForSign
    }
    // Fallback: enrich here if needed
    // Type assertion: tx has bytes property from EncodedTxData type
    const txWithBytes = tx as { bytes: Uint8Array; args: unknown; hash: string; signingData: unknown; [key: string]: unknown }
    const inner = (sdk as any).tx.getInnerTxMeta(txWithBytes.bytes) as [string, number[] | null][]
    logger.debug('[TxSubmitter] Enriching transaction metadata (fallback)', {
      innerCount: inner.length,
    })
    return {
      ...txWithBytes,
      innerTxHashes: inner.map(([hash]) => hash),
      memos: inner.map(([, memo]) => memo),
    }
  })

  logger.debug('[TxSubmitter] Transactions prepared for signing', {
    txCount: txsForSigning.length,
    innerTxHashesCount: txsForSigning[0]?.innerTxHashes?.length || 0,
  })

  // Try modern signer API if present
  try {
    if (typeof namada.getSigner === 'function') {
      const signer = await namada.getSigner()
      if (!signer) {
        throw new Error('Signer not provided by Namada extension')
      }
      logger.debug('[TxSubmitter] Using modern signer API')
      const signed = await signer.sign(txsForSigning, ownerAddress, checksums)
      if (signed && Array.isArray(signed) && signed.length > 0) {
        logger.info('[TxSubmitter] ✅ Transaction signed successfully (modern API)', {
          signedCount: signed.length,
        })
        return signed
      }
    }
  } catch (error) {
    logger.warn('[TxSubmitter] Modern signer API failed, trying fallback', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // Fallback to direct sign if exposed
  if (typeof namada.sign === 'function') {
    logger.debug('[TxSubmitter] Using fallback sign API')
    const signed = await namada.sign({ txs: txsForSigning, signer: ownerAddress, checksums })
    if (signed && Array.isArray(signed) && signed.length > 0) {
      logger.info('[TxSubmitter] ✅ Transaction signed successfully (fallback API)', {
        signedCount: signed.length,
      })
      return signed
    }
  }

  throw new Error('Signing is not supported by the Namada Keychain in this context')
}

/**
 * Broadcast signed Namada transaction via RPC.
 */
export async function broadcastNamadaTx(signedTx: Uint8Array): Promise<{ hash: string }> {
  logger.info('[TxSubmitter] 📡 Broadcasting Namada transaction...')

  try {
    const sdk = await getNamadaSdk()
    const response = await (sdk as any).rpc.broadcastTx(signedTx)

    const hash = (response as any)?.hash
    if (!hash) {
      throw new Error('Transaction broadcasted but no hash returned')
    }

    logger.info('[TxSubmitter] ✅ Transaction broadcasted successfully', {
      hash: hash.slice(0, 16) + '...',
      hashLength: hash.length,
    })

    return { hash }
  } catch (error) {
    logger.error('[TxSubmitter] Failed to broadcast transaction', {
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

/**
 * Submit a Namada transaction (sign and broadcast).
 * Handles deposit, shielding, and payment transactions.
 */
export async function submitNamadaTx(tx: TrackedTransaction): Promise<string> {
  logger.info('[TxSubmitter] 📤 Submitting Namada transaction', {
    txId: tx.id,
    direction: tx.direction,
    chain: tx.chain,
  })

  // Handle shielding transactions
  const shieldingData = (tx as TrackedTransaction & { shieldingData?: ShieldingTxData }).shieldingData
  if (shieldingData?.encodedTxData) {
    return submitShieldingTx(tx, shieldingData)
  }

  // Handle payment transactions (IBC transfers)
  const paymentData = (tx as TrackedTransaction & { paymentData?: PaymentTransactionData }).paymentData
  if (paymentData?.encodedTxData) {
    return submitPaymentTx(tx, paymentData)
  }

  // Handle other transaction types
  logger.warn('[TxSubmitter] Unsupported Namada transaction type', {
    txId: tx.id,
    direction: tx.direction,
  })
  throw new Error(`Unsupported Namada transaction direction: ${tx.direction}`)
}

/**
 * Submit a shielding transaction (sign and broadcast).
 */
async function submitShieldingTx(
  tx: TrackedTransaction,
  shieldingData: ShieldingTxData,
): Promise<string> {
  logger.info('[TxSubmitter] 🛡️  Submitting shielding transaction', {
    txId: tx.id,
    transparent: shieldingData.transparent.slice(0, 12) + '...',
    shielded: shieldingData.shielded.slice(0, 12) + '...',
    amountInBase: shieldingData.amountInBase,
  })

  if (!shieldingData.encodedTxData) {
    throw new Error('Shielding transaction data not found or not built')
  }

  try {
    // Report wallet signing stage
    const flowId = tx.flowId || tx.flowMetadata?.localId || tx.id
    await clientStageReporter.reportWalletStage(flowId, 'wallet_signing', 'namada', undefined, 'pending')

    // Sign the transaction
    logger.info('[TxSubmitter] ✍️  Signing shielding transaction...')
    const signed = await signNamadaTx(shieldingData.encodedTxData, shieldingData.transparent)

    if (!signed || !Array.isArray(signed) || signed.length === 0) {
      throw new Error('Signing returned no bytes')
    }

    logger.info('[TxSubmitter] ✅ Shielding transaction signed', {
      signedCount: signed.length,
      firstTxLength: signed[0]?.length || 0,
    })

    // Report wallet broadcasting stage
    await clientStageReporter.reportWalletStage(flowId, 'wallet_broadcasting', 'namada', undefined, 'pending')

    // Broadcast the transaction (use first signed tx)
    logger.info('[TxSubmitter] 📡 Broadcasting shielding transaction...')
    const result = await broadcastNamadaTx(signed[0])

    // Report wallet broadcasted stage
    await clientStageReporter.reportWalletStage(flowId, 'wallet_broadcasted', 'namada', result.hash, 'confirmed')

    logger.info('[TxSubmitter] ✅ Shielding transaction submitted successfully', {
      txHash: result.hash,
      txHashDisplay: `${result.hash.slice(0, 8)}...${result.hash.slice(-8)}`,
    })

    return result.hash
  } catch (error) {
    logger.error('[TxSubmitter] Failed to submit shielding transaction', {
      txId: tx.id,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

/**
 * Submit a payment transaction (IBC transfer with orbiter payload).
 * Handles disposable signer lifecycle: persist before signing, clear on error, keep on success.
 */
async function submitPaymentTx(
  tx: TrackedTransaction,
  paymentData: PaymentTransactionData,
): Promise<string> {
  logger.info('[TxSubmitter] 💸 Submitting payment transaction (IBC transfer)', {
    txId: tx.id,
    destinationAddress: paymentData.destinationAddress.slice(0, 10) + '...',
    destinationChain: paymentData.destinationChain,
    amount: paymentData.amount,
  })

  if (!paymentData.encodedTxData) {
    throw new Error('Payment transaction data not found or not built')
  }

  const disposableSignerAddress = paymentData.disposableSignerAddress
  let signerPersisted = false

  try {
    // Persist disposable signer before signing (needed for extension to pay fees)
    if (disposableSignerAddress) {
      logger.info('[TxSubmitter] 💾 Persisting disposable signer before signing...', {
        ownerAddress: disposableSignerAddress.slice(0, 12) + '...',
      })
      await persistDisposableSigner(disposableSignerAddress)
      signerPersisted = true
      logger.debug('[TxSubmitter] ✅ Disposable signer persisted')
    }

    // Report wallet signing stage
    const flowId = tx.flowId || tx.flowMetadata?.localId || tx.id
    await clientStageReporter.reportWalletStage(flowId, 'wallet_signing', 'namada', undefined, 'pending')

    // Sign the transaction
    logger.info('[TxSubmitter] ✍️  Signing payment transaction...')
    const ownerAddress = disposableSignerAddress || paymentData.ibcParams.ownerAddress
    const signed = await signNamadaTx(paymentData.encodedTxData, ownerAddress)

    if (!signed || !Array.isArray(signed) || signed.length === 0) {
      throw new Error('Signing returned no bytes')
    }

    logger.info('[TxSubmitter] ✅ Payment transaction signed', {
      signedCount: signed.length,
      firstTxLength: signed[0]?.length || 0,
    })

    // Report wallet broadcasting stage
    await clientStageReporter.reportWalletStage(flowId, 'wallet_broadcasting', 'namada', undefined, 'pending')

    // Broadcast the transaction (use first signed tx)
    logger.info('[TxSubmitter] 📡 Broadcasting payment transaction...')
    const result = await broadcastNamadaTx(signed[0])

    // Report wallet broadcasted stage
    await clientStageReporter.reportWalletStage(flowId, 'wallet_broadcasted', 'namada', result.hash, 'confirmed')

    logger.info('[TxSubmitter] ✅ Payment transaction submitted successfully', {
      txHash: result.hash,
      txHashDisplay: `${result.hash.slice(0, 8)}...${result.hash.slice(-8)}`,
      destinationChain: paymentData.destinationChain,
      amount: paymentData.amount,
    })

    // Keep disposable signer persisted on success (needed for refunds)
    // Don't clear it here - it will be cleared later when transaction is confirmed/failed
    if (signerPersisted && disposableSignerAddress) {
      logger.debug('[TxSubmitter] Keeping disposable signer persisted for refunds', {
        ownerAddress: disposableSignerAddress.slice(0, 12) + '...',
      })
    }

    return result.hash
  } catch (error) {
    // Clear disposable signer on error
    if (signerPersisted && disposableSignerAddress) {
      logger.warn('[TxSubmitter] Clearing disposable signer due to error', {
        ownerAddress: disposableSignerAddress.slice(0, 12) + '...',
        error: error instanceof Error ? error.message : String(error),
      })
      try {
        await clearDisposableSigner(disposableSignerAddress)
      } catch (clearError) {
        logger.error('[TxSubmitter] Failed to clear disposable signer after error', {
          error: clearError instanceof Error ? clearError.message : String(clearError),
        })
        // Don't throw - this is cleanup
      }
    }

    logger.error('[TxSubmitter] Failed to submit payment transaction', {
      txId: tx.id,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
