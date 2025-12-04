/**
 * Unshielding service for building unshielding transactions.
 * Handles building transactions from shielded addresses to transparent addresses.
 */

// @ts-ignore - Vite worker import
import ShieldedSyncWorker from '@/services/shielded/worker?worker'
import type {
  ShieldedWorkerRequest,
  ShieldedWorkerMessage,
  ShieldedWorkerInitPayload,
  UnshieldingParams,
  UnshieldingBuildPayload,
  EncodedTxData,
  UnshieldingTransferProps,
  ChainSettings,
} from '@/types/shielded'
import { env } from '@/config/env'
import { logger } from '@/utils/logger'
import { getNamadaSdk } from '@/services/namada/namadaSdkService'
import { getTendermintMaspIndexerUrl, getTendermintRpcUrl, getTendermintChainId } from '@/services/polling/tendermintRpcClient'
import { getDefaultNamadaChainKey } from '@/config/chains'
import { fetchTendermintChainsConfig } from '@/services/config/tendermintChainConfigService'
import { estimateGasForToken } from '@/services/namada/namadaFeeEstimatorService'
import { getUSDCAddressFromRegistry } from '@/services/namada/namadaBalanceService'

/**
 * Prepare unshielding parameters with validation and defaults.
 */
export async function prepareUnshieldingParams(
  params: Partial<UnshieldingParams> & {
    fromShielded: string
    toTransparent: string
    amountInBase: string
  },
): Promise<UnshieldingParams> {
  logger.debug('[UnshieldingService] Preparing unshielding parameters', {
    fromShielded: params.fromShielded.slice(0, 12) + '...',
    toTransparent: params.toTransparent.slice(0, 12) + '...',
    amountInBase: params.amountInBase,
  })

  // Validate required parameters
  if (!params.fromShielded || !params.toTransparent || !params.amountInBase) {
    throw new Error('Missing required unshielding parameters: fromShielded, toTransparent, amountInBase')
  }

  // Get USDC token address
  const tokenAddress = params.tokenAddress || (await getUSDCAddressFromRegistry())
  if (!tokenAddress) {
    throw new Error('USDC token address not found. Please configure VITE_USDC_TOKEN_ADDRESS')
  }

  // Get chain ID from chain config (with fallback to env)
  const tendermintConfigForChainId = await fetchTendermintChainsConfig()
  const namadaChainKeyForChainId = getDefaultNamadaChainKey(tendermintConfigForChainId) || 'namada-testnet'
  const chainId = params.chain?.chainId || await getTendermintChainId(namadaChainKeyForChainId)

  // Estimate gas (unshielding doesn't need RevealPK)
  const gas = params.gas || (await estimateGasForToken(tokenAddress, ['UnshieldingTransfer'], '90000'))

  const chain: ChainSettings = params.chain || {
    chainId,
    nativeTokenAddress: gas.gasToken,
  }

  const preparedParams: UnshieldingParams = {
    fromShielded: params.fromShielded,
    toTransparent: params.toTransparent,
    tokenAddress,
    amountInBase: params.amountInBase,
    gas,
    chain,
    memo: params.memo,
  }

  logger.debug('[UnshieldingService] Unshielding parameters prepared', {
    fromShielded: preparedParams.fromShielded.slice(0, 12) + '...',
    toTransparent: preparedParams.toTransparent.slice(0, 12) + '...',
    tokenAddress: preparedParams.tokenAddress.slice(0, 12) + '...',
    amountInBase: preparedParams.amountInBase,
    gasToken: preparedParams.gas.gasToken.slice(0, 12) + '...',
    gasLimit: preparedParams.gas.gasLimit,
  })

  return preparedParams
}

/**
 * Build unshielding transaction using worker.
 */
export async function buildUnshieldingTransaction(
  params: UnshieldingParams,
  accountPublicKey: string,
): Promise<EncodedTxData<UnshieldingTransferProps>> {
  logger.info('[UnshieldingService] Building unshielding transaction', {
    fromShielded: params.fromShielded.slice(0, 12) + '...',
    toTransparent: params.toTransparent.slice(0, 12) + '...',
    amountInBase: params.amountInBase,
  })

  // Ensure SDK is initialized (for config access)
  await getNamadaSdk()

  // Create worker
  const worker = new ShieldedSyncWorker()

  // Get values from chain config (with fallback to env)
  const tendermintConfig = await fetchTendermintChainsConfig()
  const namadaChainKey = getDefaultNamadaChainKey(tendermintConfig) || 'namada-testnet'
  const rpcUrl = await getTendermintRpcUrl(namadaChainKey)
  const maspIndexerUrl = await getTendermintMaspIndexerUrl(namadaChainKey)

  // Initialize worker
  const initPayload: ShieldedWorkerInitPayload = {
    rpcUrl: rpcUrl,
    token: env.namadaToken(),
    maspIndexerUrl: maspIndexerUrl,
    dbName: env.namadaDbName(),
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Worker initialization timeout'))
    }, 30000) // 30 second timeout

    const handler = (event: MessageEvent<ShieldedWorkerMessage>) => {
      if (event.data.type === 'ready') {
        clearTimeout(timeout)
        worker.removeEventListener('message', handler)
        resolve()
      } else if (event.data.type === 'error' && event.data.payload.code === 'INIT_ERROR') {
        clearTimeout(timeout)
        worker.removeEventListener('message', handler)
        reject(new Error(event.data.payload.message))
      }
    }

    worker.addEventListener('message', handler)
    const request: ShieldedWorkerRequest = {
      type: 'init',
      payload: initPayload,
    }
    worker.postMessage(request)
  })

  // Build transaction
  const encodedTxData = await new Promise<EncodedTxData<UnshieldingTransferProps>>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Unshielding transaction build timeout'))
    }, 60000) // 60 second timeout

    const handler = (event: MessageEvent<ShieldedWorkerMessage>) => {
      if (event.data.type === 'build-unshielding-done') {
        clearTimeout(timeout)
        worker.removeEventListener('message', handler)
        worker.terminate()
        resolve(event.data.payload)
      } else if (event.data.type === 'error') {
        clearTimeout(timeout)
        worker.removeEventListener('message', handler)
        worker.terminate()
        const errorMessage = event.data.payload.message || 'Unknown error'
        const errorCode = event.data.payload.code
        logger.error('[UnshieldingService] Worker error', {
          message: errorMessage,
          code: errorCode,
          recoverable: event.data.payload.recoverable,
          cause: event.data.payload.cause,
        })
        reject(new Error(errorMessage))
      } else if (event.data.type === 'log') {
        // Forward worker logs to main thread logger
        const logPayload = event.data.payload
        if (logPayload.level === 'error') {
          logger.error(`[ShieldedWorker] ${logPayload.message}`, logPayload.context)
        } else if (logPayload.level === 'warn') {
          logger.warn(`[ShieldedWorker] ${logPayload.message}`, logPayload.context)
        } else {
          logger.debug(`[ShieldedWorker] ${logPayload.message}`, logPayload.context)
        }
      }
    }

    worker.addEventListener('message', handler)

    const buildPayload: UnshieldingBuildPayload = {
      account: {
        address: params.toTransparent,
        publicKey: accountPublicKey,
        type: 'transparent',
      },
      gasConfig: params.gas,
      chain: params.chain,
      fromShielded: params.fromShielded,
      toTransparent: params.toTransparent,
      tokenAddress: params.tokenAddress,
      amountInBase: params.amountInBase,
      memo: params.memo,
    }

    logger.debug('[UnshieldingService] Sending build-unshielding request to worker', {
      account: {
        address: buildPayload.account.address.slice(0, 12) + '...',
        publicKey: buildPayload.account.publicKey ? buildPayload.account.publicKey.slice(0, 16) + '...' : 'EMPTY',
      },
      gasConfig: {
        token: buildPayload.gasConfig.gasToken.slice(0, 12) + '...',
        gasLimit: buildPayload.gasConfig.gasLimit,
        gasPrice: buildPayload.gasConfig.gasPriceInMinDenom,
      },
      chain: buildPayload.chain,
      fromShielded: buildPayload.fromShielded.slice(0, 12) + '...',
      toTransparent: buildPayload.toTransparent.slice(0, 12) + '...',
      tokenAddress: buildPayload.tokenAddress.slice(0, 12) + '...',
      amountInBase: buildPayload.amountInBase,
      memo: buildPayload.memo ? `[${buildPayload.memo.length} chars]` : undefined,
    })

    const request: ShieldedWorkerRequest = {
      type: 'build-unshielding',
      payload: buildPayload,
    }
    worker.postMessage(request)
  })

  logger.info('[UnshieldingService] Unshielding transaction built successfully', {
    txCount: encodedTxData.txs.length,
    txHashes: encodedTxData.txs.map((tx) => tx.hash.slice(0, 16) + '...'),
  })

  return encodedTxData
}

