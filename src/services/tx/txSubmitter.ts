import type { TrackedTransaction } from '@/types/tx'
import { ensureCorrectNetwork } from '@/services/evm/evmNetworkService'
import { depositForBurn } from '@/services/evm/evmContractService'
import type { DepositTxData } from './txBuilder'
import { logger } from '@/utils/logger'

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
    // Ensure we're on the correct network
    logger.info('[TxSubmitter] 🌐 Ensuring correct network...', {
      sourceChain: depositData.sourceChain,
    })
    await ensureCorrectNetwork(depositData.sourceChain)
    logger.info('[TxSubmitter] ✅ Network verified/switched')

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

export async function submitNamadaTx(tx: TrackedTransaction): Promise<string> {
  console.debug('submitNamadaTx', tx)
  // TODO: Bridge to Namada Keychain signing API and broadcast via RPC.
  return 'namadaTxHashTODO'
}
