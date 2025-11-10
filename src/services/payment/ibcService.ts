/**
 * IBC service for building IBC transfer transactions.
 * Handles building IBC transfers with orbiter payload for cross-chain payments.
 */

// @ts-ignore - Vite worker import
import ShieldedSyncWorker from '@/services/shielded/worker?worker'
import type {
  ShieldedWorkerRequest,
  ShieldedWorkerMessage,
  ShieldedWorkerInitPayload,
  IbcParams,
  IbcBuildPayload,
  EncodedTxData,
  IbcTransferProps,
  // GasConfig,
  // ChainSettings,
} from '@/types/shielded'
import { env } from '@/config/env'
import { logger } from '@/utils/logger'
import { getNamadaSdk } from '@/services/namada/namadaSdkService'

/**
 * Build IBC transfer transaction using worker.
 */
export async function buildIbcTransaction(
  params: IbcParams,
): Promise<EncodedTxData<IbcTransferProps>> {
  logger.info('[IbcService] Building IBC transfer transaction', {
    source: typeof params.source === 'string' ? params.source.slice(0, 12) + '...' : 'N/A',
    receiver: params.receiver,
    tokenAddress: params.tokenAddress.slice(0, 12) + '...',
    amountInBase: params.amountInBase,
    channelId: params.channelId,
  })

  // Ensure SDK is initialized (for config access)
  await getNamadaSdk()

  // Create worker
  const worker = new ShieldedSyncWorker()

  // Initialize worker
  const initPayload: ShieldedWorkerInitPayload = {
    rpcUrl: env.namadaRpc(),
    token: env.namadaToken(),
    maspIndexerUrl: env.namadaMaspIndexerUrl(),
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
  const encodedTxData = await new Promise<EncodedTxData<IbcTransferProps>>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('IBC transfer transaction build timeout'))
    }, 60000) // 60 second timeout

    const handler = (event: MessageEvent<ShieldedWorkerMessage>) => {
      if (event.data.type === 'build-ibc-transfer-done') {
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
        logger.error('[IbcService] Worker error', {
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

    const buildPayload: IbcBuildPayload = {
      account: {
        address: params.ownerAddress,
        publicKey: params.accountPublicKey,
        type: 'transparent',
      },
      gasConfig: params.gas,
      chain: params.chain,
      source: params.source,
      receiver: params.receiver,
      tokenAddress: params.tokenAddress,
      amountInBase: params.amountInBase,
      portId: params.portId,
      channelId: params.channelId,
      timeoutHeight: params.timeoutHeight,
      timeoutSecOffset: params.timeoutSecOffset,
      memo: params.memo,
      refundTarget: params.refundTarget,
      gasSpendingKey: params.gasSpendingKey,
    }

    logger.debug('[IbcService] Sending build-ibc-transfer request to worker', {
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
      source: typeof buildPayload.source === 'string' ? buildPayload.source.slice(0, 12) + '...' : 'N/A',
      receiver: buildPayload.receiver,
      tokenAddress: buildPayload.tokenAddress.slice(0, 12) + '...',
      amountInBase: buildPayload.amountInBase,
      portId: buildPayload.portId,
      channelId: buildPayload.channelId,
      memo: buildPayload.memo ? `[${buildPayload.memo.length} chars]` : undefined,
      refundTarget: buildPayload.refundTarget ? buildPayload.refundTarget.slice(0, 12) + '...' : undefined,
      hasGasSpendingKey: Boolean(buildPayload.gasSpendingKey),
    })

    const request: ShieldedWorkerRequest = {
      type: 'build-ibc-transfer',
      payload: buildPayload,
    }
    worker.postMessage(request)
  })

  logger.info('[IbcService] IBC transfer transaction built successfully', {
    txCount: encodedTxData.txs.length,
    hasRevealPk: encodedTxData.txs.some((tx) => tx.innerTxHashes.length > 1),
    txHashes: encodedTxData.txs.map((tx) => tx.hash.slice(0, 16) + '...'),
  })

  return encodedTxData
}

