import type { TrackedTransaction } from '@/types/tx'
import { fetchNobleForwardingAddress } from '@/services/deposit/nobleForwardingService'
import { encodeBech32ToBytes32 } from '@/services/evm/evmUtils'
import { env } from '@/config/env'
import { logger } from '@/utils/logger'
import {
  prepareShieldingParams,
  buildShieldingTransaction,
  // type ShieldingParams,
} from '@/services/shielded/shieldingService'
import type { EncodedTxData } from '@/types/shielded'

export interface BuildTxParams {
  amount: string
  sourceChain: string
  destinationChain: string
  recipient: string
}

export interface DepositTxData {
  amount: string
  sourceChain: string
  destinationAddress: string
  nobleForwardingAddress: string
  forwardingAddressBytes32: string
  destinationDomain: number
}

/**
 * Builds a deposit transaction by fetching Noble forwarding address
 * and encoding it for the CCTP contract call.
 */
export async function buildDepositTx(params: BuildTxParams): Promise<TrackedTransaction & { depositData?: DepositTxData }> {
  logger.info('[TxBuilder] 🏗️  Building deposit transaction', {
    amount: params.amount,
    sourceChain: params.sourceChain,
    destinationChain: params.destinationChain,
    recipient: params.recipient,
  })

  try {
    // Fetch Noble forwarding address for the Namada destination address
    logger.info('[TxBuilder] 🔍 Fetching Noble forwarding address...', {
      namadaAddress: params.recipient,
    })
    const nobleForwardingAddress = await fetchNobleForwardingAddress(params.recipient)
    logger.info('[TxBuilder] ✅ Noble forwarding address fetched', {
      nobleForwardingAddress,
    })

    // Encode the forwarding address to bytes32 format
    logger.info('[TxBuilder] 🔧 Encoding forwarding address to bytes32...')
    const forwardingAddressBytes32 = encodeBech32ToBytes32(nobleForwardingAddress)
    logger.info('[TxBuilder] ✅ Forwarding address encoded', {
      forwardingAddressBytes32,
      length: forwardingAddressBytes32.length,
    })

    // Get destination domain (Noble CCTP domain)
    const destinationDomain = env.nobleDomainId()
    logger.info('[TxBuilder] 📋 CCTP destination domain', {
      destinationDomain,
    })

    const depositData: DepositTxData = {
      amount: params.amount,
      sourceChain: params.sourceChain,
      destinationAddress: params.recipient,
      nobleForwardingAddress,
      forwardingAddressBytes32,
      destinationDomain,
    }

    const txId = crypto.randomUUID()
    logger.info('[TxBuilder] ✅ Deposit transaction built successfully', {
      txId,
      depositData: {
        amount: depositData.amount,
        sourceChain: depositData.sourceChain,
        destinationAddress: depositData.destinationAddress,
        nobleForwardingAddress: depositData.nobleForwardingAddress,
        forwardingAddressBytes32: depositData.forwardingAddressBytes32,
        destinationDomain: depositData.destinationDomain,
      },
    })

    const now = Date.now()
    return {
      id: txId,
      createdAt: now,
      updatedAt: now,
      chain: params.sourceChain, // Deposits originate from EVM chain
      direction: 'deposit',
      status: 'building',
      depositData,
    }
  } catch (error) {
    console.error('[TxBuilder] Failed to build deposit transaction', {
      params,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

export interface BuildShieldingTxParams {
  transparent: string
  shielded: string
  amountInBase: string
  tokenAddress?: string
  memo?: string
  publicKey?: string
}

export interface ShieldingTxData {
  transparent: string
  shielded: string
  tokenAddress: string
  amountInBase: string
  gasToken: string
  chainId: string
  memo?: string
  encodedTxData?: EncodedTxData
}

/**
 * Builds a shielding transaction (transparent → shielded).
 */
export async function buildShieldingTx(
  params: BuildShieldingTxParams,
): Promise<TrackedTransaction & { shieldingData?: ShieldingTxData }> {
  logger.info('[TxBuilder] 🏗️  Building shielding transaction', {
    transparent: params.transparent.slice(0, 12) + '...',
    shielded: params.shielded.slice(0, 12) + '...',
    amountInBase: params.amountInBase,
  })

  try {
    // Prepare shielding parameters
    logger.debug('[TxBuilder] Preparing shielding parameters...')
    const shieldingParams = await prepareShieldingParams({
      transparent: params.transparent,
      shielded: params.shielded,
      amountInBase: params.amountInBase,
      tokenAddress: params.tokenAddress,
      memo: params.memo,
      publicKey: params.publicKey,
    })

    logger.debug('[TxBuilder] Shielding parameters prepared', {
      transparent: shieldingParams.transparent.slice(0, 12) + '...',
      shielded: shieldingParams.shielded.slice(0, 12) + '...',
      tokenAddress: shieldingParams.tokenAddress.slice(0, 12) + '...',
      amountInBase: shieldingParams.amountInBase,
      gasToken: shieldingParams.gas.gasToken.slice(0, 12) + '...',
    })

    // Build the transaction
    logger.info('[TxBuilder] 🔨 Building shielding transaction via worker...')
    const encodedTxData = await buildShieldingTransaction(shieldingParams)

    logger.info('[TxBuilder] ✅ Shielding transaction built successfully', {
      txCount: encodedTxData.txs.length,
      hasRevealPk: encodedTxData.txs.some((tx) => tx.innerTxHashes.length > 1),
    })

    const shieldingData: ShieldingTxData = {
      transparent: shieldingParams.transparent,
      shielded: shieldingParams.shielded,
      tokenAddress: shieldingParams.tokenAddress,
      amountInBase: shieldingParams.amountInBase,
      gasToken: shieldingParams.gas.gasToken,
      chainId: shieldingParams.chain.chainId,
      memo: shieldingParams.memo,
      encodedTxData,
    }

    const txId = crypto.randomUUID()
    logger.info('[TxBuilder] ✅ Shielding transaction built and tracked', {
      txId,
      shieldingData: {
        transparent: shieldingData.transparent.slice(0, 12) + '...',
        shielded: shieldingData.shielded.slice(0, 12) + '...',
        tokenAddress: shieldingData.tokenAddress.slice(0, 12) + '...',
        amountInBase: shieldingData.amountInBase,
        gasToken: shieldingData.gasToken.slice(0, 12) + '...',
        chainId: shieldingData.chainId,
      },
    })

    const now = Date.now()
    return {
      id: txId,
      createdAt: now,
      updatedAt: now,
      chain: shieldingParams.chain.chainId,
      direction: 'send', // Shielding is a type of send operation
      status: 'building',
      shieldingData,
    }
  } catch (error) {
    logger.error('[TxBuilder] Failed to build shielding transaction', {
      params: {
        transparent: params.transparent.slice(0, 12) + '...',
        shielded: params.shielded.slice(0, 12) + '...',
        amountInBase: params.amountInBase,
      },
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

export async function buildPaymentTx(
  params: BuildTxParams & {
    transparentAddress: string
    shieldedAddress?: string
  },
): Promise<TrackedTransaction & { paymentData?: import('@/types/shielded').PaymentTransactionData }> {
  logger.debug('[TxBuilder] Building payment transaction', {
    amount: params.amount,
    destinationAddress: params.recipient.slice(0, 10) + '...',
    destinationChain: params.destinationChain,
    transparent: params.transparentAddress.slice(0, 12) + '...',
  })

  // Delegate to payment service
  const { buildPaymentTransaction } = await import('@/services/payment/paymentService')
  return buildPaymentTransaction({
    amount: params.amount,
    destinationAddress: params.recipient,
    destinationChain: params.destinationChain,
    transparentAddress: params.transparentAddress,
    shieldedAddress: params.shieldedAddress,
  })
}
