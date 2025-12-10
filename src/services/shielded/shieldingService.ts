/**
 * Shielding service for building, estimating gas, and preparing shielding transactions.
 */

// @ts-ignore - Vite worker import
import ShieldedSyncWorker from './worker?worker'
import type {
  ShieldedWorkerRequest,
  ShieldedWorkerMessage,
  ShieldedWorkerInitPayload,
  ShieldingParams,
  ShieldingBuildPayload,
  EncodedTxData,
  GasConfig,
  ChainSettings,
} from '@/types/shielded'
import { env } from '@/config/env'
import { logger } from '@/utils/logger'
import { getNamadaSdk } from '@/services/namada/namadaSdkService'
import { estimateShieldingGas } from '@/services/namada/namadaFeeEstimatorService'
import { getTendermintChainId } from '@/services/polling/tendermintRpcClient'
import { getEffectiveRpcUrl, getEffectiveMaspIndexerUrl } from '@/services/config/customUrlResolver'
import { getDefaultNamadaChainKey } from '@/config/chains'
import { fetchTendermintChainsConfig } from '@/services/config/tendermintChainConfigService'
import { getUSDCAddressFromRegistry } from '@/services/namada/namadaBalanceService'
import BigNumber from 'bignumber.js'

/**
 * Get public key from Namada extension for a given address.
 */
async function getPublicKeyFromExtension(address: string): Promise<string | null> {
  try {
    const namada = (window as any).namada
    if (!namada?.accounts) {
      logger.warn('[ShieldingService] Namada extension not available')
      return null
    }

    const accounts = await namada.accounts()
    const account = accounts.find((acc: any) => acc.address === address)
    if (account?.publicKey) {
      logger.debug('[ShieldingService] Public key retrieved from extension', {
        address: address.slice(0, 12) + '...',
        publicKey: account.publicKey.slice(0, 16) + '...',
      })
      return account.publicKey
    }

    logger.debug('[ShieldingService] No public key found in extension for address', {
      address: address.slice(0, 12) + '...',
    })
    return null
  } catch (error) {
    logger.warn('[ShieldingService] Failed to get public key from extension', {
      error: error instanceof Error ? error.message : String(error),
      address: address.slice(0, 12) + '...',
    })
    return null
  }
}

/**
 * Get shielded payment address (starting with 'z') from Namada extension for a given transparent address.
 * This finds the child account with address starting with 'z' that is associated with the transparent account.
 *
 * @param transparentAddress - The transparent address to find the shielded payment address for
 * @returns The shielded payment address (starting with 'z') or null if not found
 */
export async function getShieldedPaymentAddressFromExtension(
  transparentAddress: string,
): Promise<string | null> {
  try {
    const namada = (window as any).namada
    if (!namada?.accounts) {
      logger.warn('[ShieldingService] Namada extension not available')
      return null
    }

    const accounts = await namada.accounts()
    if (!Array.isArray(accounts)) {
      logger.warn('[ShieldingService] Accounts is not an array')
      return null
    }

    // Find the parent account (transparent)
    const parent = accounts.find((a: any) => a?.address === transparentAddress)
    if (!parent?.id) {
      logger.debug('[ShieldingService] Parent account not found for transparent address', {
        transparent: transparentAddress.slice(0, 12) + '...',
      })
      return null
    }

    // Find the child account with address starting with 'z' (shielded payment address)
    const child = accounts.find(
      (a: any) =>
        a?.parentId === parent.id &&
        typeof a?.address === 'string' &&
        String(a?.type || '').toLowerCase().includes('shielded') &&
        String(a.address).startsWith('z'),
    )

    if (child?.address) {
      logger.debug('[ShieldingService] Shielded payment address retrieved from extension', {
        transparent: transparentAddress.slice(0, 12) + '...',
        shielded: child.address.slice(0, 12) + '...',
      })
      return child.address
    }

    logger.debug('[ShieldingService] No shielded payment address found for transparent address', {
      transparent: transparentAddress.slice(0, 12) + '...',
    })
    return null
  } catch (error) {
    logger.warn('[ShieldingService] Failed to get shielded payment address from extension', {
      error: error instanceof Error ? error.message : String(error),
      transparent: transparentAddress.slice(0, 12) + '...',
    })
    return null
  }
}

/**
 * Check if public key is revealed on chain.
 */
export async function isPublicKeyRevealed(address: string): Promise<boolean> {
  try {
    const sdk = await getNamadaSdk()
    const revealed = await sdk.rpc.queryPublicKey(address)
    const isRevealed = Boolean(revealed)
    logger.debug('[ShieldingService] Public key reveal status', {
      address: address.slice(0, 12) + '...',
      isRevealed,
    })
    return isRevealed
  } catch (error) {
    logger.warn('[ShieldingService] Failed to check public key reveal status', {
      error: error instanceof Error ? error.message : String(error),
      address: address.slice(0, 12) + '...',
    })
    return false
  }
}

/**
 * Prepare shielding parameters with validation and defaults.
 */
export async function prepareShieldingParams(
  params: Partial<ShieldingParams> & {
    transparent: string
    shielded: string
    amountInBase: string
  },
): Promise<ShieldingParams> {
  logger.debug('[ShieldingService] Preparing shielding parameters', {
    transparent: params.transparent.slice(0, 12) + '...',
    shielded: params.shielded.slice(0, 12) + '...',
    amountInBase: params.amountInBase,
  })

  // Validate required parameters
  if (!params.transparent || !params.shielded || !params.amountInBase) {
    throw new Error('Missing required shielding parameters: transparent, shielded, amountInBase')
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

  // Get public key from extension
  const publicKey = params.publicKey || (await getPublicKeyFromExtension(params.transparent))

  // Check if public key is revealed
  const needsRevealPk = publicKey ? !(await isPublicKeyRevealed(params.transparent)) : false

  // Estimate gas
  const gas = params.gas || (await estimateShieldingGas(tokenAddress, needsRevealPk))

  // Handle gas fee subtraction if using same token
  let amountInBase = new BigNumber(params.amountInBase)
  if (gas.gasToken === tokenAddress) {
    const gasFeeInMinDenom = new BigNumber(gas.gasLimit).multipliedBy(gas.gasPriceInMinDenom)
    amountInBase = BigNumber.max(amountInBase.minus(gasFeeInMinDenom), 0)
    logger.info('[ShieldingService] Subtracting gas fees from amount', {
      gasFee: gasFeeInMinDenom.toString(),
      originalAmount: params.amountInBase,
      adjustedAmount: amountInBase.toString(),
    })
  }

  const chain: ChainSettings = params.chain || {
    chainId,
    nativeTokenAddress: gas.gasToken,
  }

  const preparedParams: ShieldingParams = {
    transparent: params.transparent,
    shielded: params.shielded,
    tokenAddress,
    amountInBase: amountInBase.toString(),
    gas,
    chain,
    publicKey: publicKey || undefined,
    memo: params.memo,
  }

  logger.debug('[ShieldingService] Shielding parameters prepared', {
    transparent: preparedParams.transparent.slice(0, 12) + '...',
    shielded: preparedParams.shielded.slice(0, 12) + '...',
    tokenAddress: preparedParams.tokenAddress.slice(0, 12) + '...',
    amountInBase: preparedParams.amountInBase,
    gasToken: preparedParams.gas.gasToken.slice(0, 12) + '...',
    gasLimit: preparedParams.gas.gasLimit,
    needsRevealPk,
  })

  return preparedParams
}

/**
 * Build shielding transaction using worker.
 */
export async function buildShieldingTransaction(
  params: ShieldingParams,
): Promise<EncodedTxData> {
  logger.info('[ShieldingService] Building shielding transaction', {
    transparent: params.transparent.slice(0, 12) + '...',
    shielded: params.shielded.slice(0, 12) + '...',
    amountInBase: params.amountInBase,
  })

  // Ensure SDK is initialized (for config access)
  await getNamadaSdk()

  // Create worker
  const worker = new ShieldedSyncWorker()

  // Get values from chain config (with fallback to env)
  const tendermintConfig = await fetchTendermintChainsConfig()
  const namadaChainKey = getDefaultNamadaChainKey(tendermintConfig) || 'namada-testnet'
  const rpcUrl = await getEffectiveRpcUrl(namadaChainKey, 'tendermint')
  const maspIndexerUrl = await getEffectiveMaspIndexerUrl(namadaChainKey)

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
  const encodedTxData = await new Promise<EncodedTxData>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Shielding transaction build timeout'))
    }, 60000) // 60 second timeout

    const handler = (event: MessageEvent<ShieldedWorkerMessage>) => {
      if (event.data.type === 'build-shielding-done') {
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
        logger.error('[ShieldingService] Worker error', {
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

    const buildPayload: ShieldingBuildPayload = {
      account: {
        address: params.transparent,
        publicKey: params.publicKey || '',
        type: 'transparent',
      },
      gasConfig: params.gas,
      chain: params.chain,
      fromTransparent: params.transparent,
      toShielded: params.shielded,
      tokenAddress: params.tokenAddress,
      amountInBase: params.amountInBase,
      memo: params.memo,
    }

    logger.debug('[ShieldingService] Sending build-shielding request to worker', {
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
      fromTransparent: buildPayload.fromTransparent.slice(0, 12) + '...',
      toShielded: buildPayload.toShielded.slice(0, 12) + '...',
      tokenAddress: buildPayload.tokenAddress.slice(0, 12) + '...',
      amountInBase: buildPayload.amountInBase,
      memo: buildPayload.memo ? `[${buildPayload.memo.length} chars]` : undefined,
    })

    const request: ShieldedWorkerRequest = {
      type: 'build-shielding',
      payload: buildPayload,
    }
    worker.postMessage(request)
  })

  logger.info('[ShieldingService] Shielding transaction built successfully', {
    txCount: encodedTxData.txs.length,
    hasRevealPk: encodedTxData.txs.some((tx) => tx.innerTxHashes.length > 1),
  })

  return encodedTxData
}

/**
 * Estimate gas for shielding transaction.
 */
export async function estimateShieldingGasForParams(
  tokenAddress: string,
  hasPublicKey: boolean,
): Promise<GasConfig> {
  logger.debug('[ShieldingService] Estimating gas for shielding', {
    tokenAddress: tokenAddress.slice(0, 12) + '...',
    hasPublicKey,
  })

  // Check if public key is revealed (if we have one)
  let needsRevealPk = false
  if (!hasPublicKey) {
    // If no public key provided, we'll need to reveal it
    needsRevealPk = true
  }

  const gas = await estimateShieldingGas(tokenAddress, needsRevealPk)

  logger.info('[ShieldingService] Gas estimation complete', {
    gasToken: gas.gasToken.slice(0, 12) + '...',
    gasLimit: gas.gasLimit,
    gasPrice: gas.gasPriceInMinDenom,
    needsRevealPk,
  })

  return gas
}

/**
 * Fee information for display purposes.
 */
export interface ShieldingFeeInfo {
  feeAmount: string
  feeToken: 'USDC' | 'NAM'
  finalAmount: string
  gasConfig: GasConfig
}

/**
 * Estimate shielding fee for display purposes.
 * This uses the same logic as prepareShieldingParams but returns display-friendly information.
 *
 * @param transparentAddress - The transparent address
 * @param amountInDisplayUnits - The amount in display units (e.g., "10.5" for 10.5 USDC)
 * @returns Fee information including fee amount, token, and final amount after fees
 */
export async function estimateShieldingFeeForDisplay(
  transparentAddress: string,
  amountInDisplayUnits: string,
): Promise<ShieldingFeeInfo> {
  logger.debug('[ShieldingService] Estimating shielding fee for display', {
    transparent: transparentAddress.slice(0, 12) + '...',
    amount: amountInDisplayUnits,
  })

  // Get USDC token address
  const tokenAddress = await getUSDCAddressFromRegistry()
  if (!tokenAddress) {
    throw new Error('USDC token address not found. Please configure VITE_USDC_TOKEN_ADDRESS')
  }

  // Get public key from extension
  const publicKey = await getPublicKeyFromExtension(transparentAddress)

  // Check if public key is revealed
  const needsRevealPk = publicKey ? !(await isPublicKeyRevealed(transparentAddress)) : false

  // Estimate gas (same logic as prepareShieldingParams)
  const gas = await estimateShieldingGas(tokenAddress, needsRevealPk)

  // Calculate fee amount (gasLimit × gasPrice)
  const gasLimitBN = new BigNumber(gas.gasLimit)
  const gasPriceBN = new BigNumber(gas.gasPriceInMinDenom)
  const feeInMinDenom = gasLimitBN.multipliedBy(gasPriceBN)

  // Convert fee to display units (both USDC and NAM use 6 decimals)
  const feeInDisplayUnits = feeInMinDenom.dividedBy(new BigNumber(10).pow(6))

  // Determine fee token display name
  const feeToken: 'USDC' | 'NAM' = gas.gasToken === tokenAddress ? 'USDC' : 'NAM'

  // Calculate final amount after fees (if fees are paid in USDC, subtract from amount)
  const amountBN = new BigNumber(amountInDisplayUnits)
  let finalAmountBN = amountBN
  if (feeToken === 'USDC') {
    finalAmountBN = BigNumber.max(amountBN.minus(feeInDisplayUnits), 0)
  }

  const feeInfo: ShieldingFeeInfo = {
    feeAmount: feeInDisplayUnits.toFixed(6),
    feeToken,
    finalAmount: finalAmountBN.toFixed(6),
    gasConfig: gas,
  }

  logger.debug('[ShieldingService] Fee estimation for display complete', {
    feeAmount: feeInfo.feeAmount,
    feeToken: feeInfo.feeToken,
    finalAmount: feeInfo.finalAmount,
    gasToken: gas.gasToken.slice(0, 12) + '...',
    needsRevealPk,
  })

  return feeInfo
}

