/// <reference lib="webworker" />

import { initSdk } from '@namada/sdk-multicore/inline'
import { SdkEvents, ProgressBarNames } from '@namada/sdk-multicore'
import type {
  Sdk,
  WrapperTxMsgValue,
  ShieldingTransferMsgValue,
  ShieldedTransferDataMsgValue,
  UnshieldingTransferProps as SdkUnshieldingTransferProps,
  IbcTransferProps as SdkIbcTransferProps,
  // TxMsgValue,
  TxProps,
} from '@namada/sdk-multicore'
import BigNumber from 'bignumber.js'
import type {
  ShieldedWorkerRequest,
  ShieldedWorkerMessage,
  ShieldedWorkerInitPayload,
  ShieldedWorkerSyncPayload,
  ShieldedSyncProgress,
  ShieldedSyncResult,
  ShieldedWorkerErrorPayload,
  ShieldedWorkerLogPayload,
  ShieldingBuildPayload,
  UnshieldingBuildPayload,
  IbcBuildPayload,
  IbcTransferProps,
  UnshieldingTransferProps,
  GasConfig,
  ChainSettings,
  EncodedTxData,
} from '@/types/shielded'
import { ensureMaspReady } from './maspHelpers'

declare const self: DedicatedWorkerGlobalScope

let sdk: Sdk | undefined
let isInitialized = false
let isSyncing = false
let currentChainId: string | undefined

/**
 * Post a message to the main thread.
 */
function post(message: ShieldedWorkerMessage): void {
  self.postMessage(message)
}

/**
 * Post a log message to the main thread.
 */
function log(level: 'info' | 'warn' | 'error', message: string, context?: Record<string, unknown>): void {
  const payload: ShieldedWorkerLogPayload = { level, message, context }
  post({ type: 'log', payload })
}

/**
 * Post an error message to the main thread.
 */
function postError(message: string, code?: string, cause?: unknown, recoverable = false): void {
  const payload: ShieldedWorkerErrorPayload = { message, code, cause, recoverable }
  post({ type: 'error', payload })
}

/**
 * Convert SDK progress event to our progress format.
 */
function parseProgressEvent(detail: string): ShieldedSyncProgress | null {
  try {
    const data = JSON.parse(detail) as {
      name?: string
      current?: number
      total?: number
      step?: string
      message?: string
    }

    // Only handle Fetched progress bar events
    if (data.name !== ProgressBarNames.Fetched) {
      return null
    }

    const stage: ShieldedSyncProgress['stage'] = isSyncing ? 'syncing' : 'initializing'

    return {
      stage,
      current: typeof data.current === 'number' ? data.current : undefined,
      total: typeof data.total === 'number' ? data.total : undefined,
      step: data.step,
      message: data.message,
    }
  } catch {
    return null
  }
}

/**
 * Setup SDK progress event listeners.
 */
function setupProgressListeners(): void {
  const handleStarted = (e: Event) => {
    const ev = e as CustomEvent<string>
    const progress = parseProgressEvent(ev.detail)
    if (progress) {
      post({ type: 'progress', payload: progress })
    }
  }

  const handleIncremented = (e: Event) => {
    const ev = e as CustomEvent<string>
    const progress = parseProgressEvent(ev.detail)
    if (progress) {
      post({ type: 'progress', payload: progress })
    }
  }

  const handleFinished = (e: Event) => {
    const ev = e as CustomEvent<string>
    const progress = parseProgressEvent(ev.detail)
    if (progress) {
      post({ type: 'progress', payload: progress })
    }
  }

  self.addEventListener(SdkEvents.ProgressBarStarted, handleStarted as EventListener)
  self.addEventListener(SdkEvents.ProgressBarIncremented, handleIncremented as EventListener)
  self.addEventListener(SdkEvents.ProgressBarFinished, handleFinished as EventListener)
}

/**
 * Handle init request.
 */
async function handleInit(payload: ShieldedWorkerInitPayload): Promise<void> {
  if (isInitialized && sdk) {
    log('warn', 'SDK already initialized, skipping init')
    post({ type: 'ready', payload: { chainId: currentChainId } })
    return
  }

  try {
    log('info', 'Initializing Namada SDK in worker', {
      rpcUrl: payload.rpcUrl,
      maspIndexerUrl: payload.maspIndexerUrl,
      dbName: payload.dbName,
    })

    sdk = await initSdk({
      rpcUrl: payload.rpcUrl,
      token: payload.token,
      maspIndexerUrl: payload.maspIndexerUrl,
      dbName: payload.dbName,
    })

    setupProgressListeners()

    isInitialized = true
    log('info', 'SDK initialized successfully')
    post({ type: 'ready' })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log('error', 'Failed to initialize SDK', { error: message })
    postError('Failed to initialize SDK', 'INIT_ERROR', error, false)
  }
}

/**
 * Handle sync request.
 */
async function handleSync(payload: ShieldedWorkerSyncPayload): Promise<void> {
  if (!sdk || !isInitialized) {
    postError('SDK not initialized', 'SDK_NOT_INITIALIZED', undefined, true)
    return
  }

  if (isSyncing) {
    log('warn', 'Sync already in progress, ignoring request')
    return
  }

  try {
    isSyncing = true
    currentChainId = payload.chainId

    log('info', 'Starting shielded sync', {
      chainId: payload.chainId,
      viewingKeyCount: payload.viewingKeys.length,
    })

    // Ensure MASP params are ready
    post({
      type: 'progress',
      payload: { stage: 'loading-params', message: 'Loading MASP parameters...' },
    })

    // Get MASP params URL from environment or use default
    const { env } = await import('@/config/env')
    const paramsUrl = env.namadaMaspParamsUrl()

    await ensureMaspReady({
      sdk,
      chainId: payload.chainId,
      paramsUrl,
    })

    // Convert viewing keys to SDK format
    const vks = payload.viewingKeys.map((vk) => ({
      key: vk.key,
      birthday: vk.birthday ?? 0,
    }))

    // Start sync
    post({
      type: 'progress',
      payload: { stage: 'syncing', message: 'Syncing shielded notes...' },
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (sdk.rpc as any).shieldedSync(vks, payload.chainId)

    const result: ShieldedSyncResult = {
      chainId: payload.chainId,
      completedAt: Date.now(),
      viewingKeyCount: payload.viewingKeys.length,
    }

    log('info', 'Shielded sync completed', { chainId: payload.chainId })
    post({ type: 'complete', payload: result })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log('error', 'Shielded sync failed', { error: message, chainId: payload.chainId })
    postError('Shielded sync failed', 'SYNC_ERROR', error, true)
  } finally {
    isSyncing = false
  }
}

/**
 * Handle stop request.
 */
function handleStop(): void {
  if (!isSyncing) {
    log('warn', 'No sync in progress, ignoring stop request')
    return
  }

  log('info', 'Stop requested (sync will complete current operation)')
  // Note: SDK doesn't support cancellation, so we just mark as not syncing
  // The current sync will complete or error naturally
  isSyncing = false
}

/**
 * Get transaction props for wrapper transaction.
 */
function getTxProps(
  account: { address: string; publicKey: string; type?: string },
  gasConfig: GasConfig,
  chain: ChainSettings,
  memo?: string,
): WrapperTxMsgValue {
  return {
    token: gasConfig.gasToken,
    feeAmount: new BigNumber(gasConfig.gasPriceInMinDenom),
    gasLimit: new BigNumber(gasConfig.gasLimit),
    chainId: chain.chainId,
    publicKey: account.publicKey,
    memo,
  }
}

/**
 * Check if public key is revealed on chain.
 */
async function isPublicKeyRevealed(address: string): Promise<boolean> {
  if (!sdk) return false
  try {
    if (!address || address.trim() === '') {
      return false
    }
    const revealed = await sdk.rpc.queryPublicKey(address)
    return Boolean(revealed)
  } catch (error) {
    log('warn', 'Failed to check public key reveal status', { error: String(error) })
    return false
  }
}

/**
 * Generic buildTx function for creating transactions.
 */
async function buildTx<T>(
  account: { address: string; publicKey: string; type?: string },
  gasConfig: GasConfig,
  chain: ChainSettings,
  queryProps: T[],
  txFn: (wrapperTxProps: WrapperTxMsgValue, props: T) => Promise<TxProps>,
  memo?: string,
  shouldRevealPk = true,
): Promise<EncodedTxData<T>> {
  if (!sdk) {
    throw new Error('SDK not initialized')
  }
  // Store sdk in local variable to ensure TypeScript knows it's defined
  const sdkInstance = sdk

  const txs: TxProps[] = []
  const wrapperTxProps = getTxProps(account, gasConfig, chain, memo)

  // Check if RevealPK is needed
  if (shouldRevealPk) {
    log('info', 'Checking if public key reveal is needed', {
      address: account.address.slice(0, 12) + '...',
      publicKey: account.publicKey ? account.publicKey.slice(0, 16) + '...' : 'EMPTY',
    })
    
    const publicKeyRevealed = await isPublicKeyRevealed(account.address)
    log('info', 'Public key revealed status', {
      address: account.address.slice(0, 12) + '...',
      isRevealed: publicKeyRevealed,
    })
    
    if (!publicKeyRevealed) {
      log('info', 'Public key not revealed, building RevealPK transaction', {
        address: account.address.slice(0, 12) + '...',
      })
      log('info', 'WrapperTxProps for RevealPK', {
        token: wrapperTxProps.token,
        feeAmount: wrapperTxProps.feeAmount?.toString(),
        gasLimit: wrapperTxProps.gasLimit?.toString(),
        chainId: wrapperTxProps.chainId,
        publicKey: wrapperTxProps.publicKey ? wrapperTxProps.publicKey.slice(0, 16) + '...' : 'EMPTY',
        memo: wrapperTxProps.memo,
      })
      
      try {
        const revealPkTx = await sdkInstance.tx.buildRevealPk(wrapperTxProps)
        txs.push(revealPkTx)
        log('info', 'RevealPK transaction built successfully')
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        const errorStack = error instanceof Error ? error.stack : undefined
        log('error', 'Failed to build RevealPK transaction', {
          error: errorMessage,
          errorStack,
          address: account.address.slice(0, 12) + '...',
        })
        throw error
      }
    }
  }

  // Build the main transaction(s)
  // Use .apply() to ensure the function is called with the correct 'this' context (sdk.tx)
  for (const props of queryProps) {
    const tx = await txFn.apply(sdkInstance.tx, [wrapperTxProps, props])
    txs.push(tx)
  }

  // Batch transactions
  const txProps = [sdkInstance.tx.buildBatch(txs)]

  return {
    type: 'shielding-transfer',
    txs: txProps.map(({ args, hash, bytes, signingData }) => {
      const innerTxHashes = sdkInstance.tx.getInnerTxMeta(bytes) as [string, number[] | null][]
      return {
        args,
        hash,
        bytes,
        signingData,
        innerTxHashes: innerTxHashes.map(([hash]) => hash),
        memos: innerTxHashes.map(([, memo]) => memo),
      }
    }),
    wrapperTxProps: {
      token: wrapperTxProps.token,
      feeAmount: wrapperTxProps.feeAmount.toString(),
      gasLimit: wrapperTxProps.gasLimit.toString(),
      chainId: wrapperTxProps.chainId,
      publicKey: wrapperTxProps.publicKey,
      memo: wrapperTxProps.memo,
    },
    meta: {
      props: queryProps,
    },
  }
}

/**
 * Handle build-shielding request.
 */
async function handleBuildShielding(payload: ShieldingBuildPayload): Promise<void> {
  if (!sdk || !isInitialized) {
    postError('SDK not initialized', 'SDK_NOT_INITIALIZED', undefined, true)
    return
  }

  try {
    const { account, gasConfig, chain, fromTransparent, toShielded, tokenAddress, amountInBase, memo } = payload

    // Log sanitized inputs
    log('info', 'Building shielding transaction', {
      account: {
        address: account.address.slice(0, 12) + '...',
        publicKey: account.publicKey ? account.publicKey.slice(0, 16) + '...' : 'EMPTY',
        type: account.type,
      },
      gasConfig: {
        token: gasConfig.gasToken,
        gasLimit: gasConfig.gasLimit,
        gasPrice: gasConfig.gasPriceInMinDenom,
      },
      chain,
      fromTransparent: fromTransparent.slice(0, 12) + '...',
      toShielded: toShielded.slice(0, 12) + '...',
      tokenAddress,
      amountInBase,
      memo: memo ? `[${memo.length} chars]` : undefined,
    })

    // Ensure MASP params are loaded
    try {
      await sdk.masp.loadMaspParams('', chain.chainId)
    } catch (error) {
      log('warn', 'Failed to load MASP params, continuing anyway', { error: String(error) })
    }

    // Create shielding props
    const shieldingProps: ShieldingTransferMsgValue = {
      target: toShielded,
      data: [
        {
          source: fromTransparent,
          token: tokenAddress,
          amount: new BigNumber(amountInBase),
        } as ShieldedTransferDataMsgValue,
      ],
    }

    // Build transaction
    log('info', 'Building shielding transfer transaction', {
      account: {
        address: account.address.slice(0, 12) + '...',
        publicKey: account.publicKey ? account.publicKey.slice(0, 16) + '...' : 'EMPTY',
        type: account.type,
      },
      shieldingProps: {
        target: shieldingProps.target.slice(0, 12) + '...',
        dataCount: shieldingProps.data.length,
        amount: shieldingProps.data[0]?.amount?.toString(),
      },
    })

    const encodedTxData = await buildTx<ShieldingTransferMsgValue>(
      account,
      gasConfig,
      chain,
      [shieldingProps],
      sdk.tx.buildShieldingTransfer,
      memo,
      true, // shouldRevealPk
    )

    log('info', 'Shielding transaction built successfully', {
      txCount: encodedTxData.txs.length,
      hasRevealPk: encodedTxData.txs.some((tx) => tx.innerTxHashes.length > 1),
      txHashes: encodedTxData.txs.map((tx) => tx.hash.slice(0, 16) + '...'),
    })

    post({ type: 'build-shielding-done', payload: encodedTxData })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : undefined
    const errorCause = error instanceof Error ? error.cause : undefined
    
    log('error', 'Failed to build shielding transaction', {
      error: errorMessage,
      errorStack,
      errorCause: errorCause ? String(errorCause) : undefined,
      payload: {
        account: payload.account.address.slice(0, 12) + '...',
        fromTransparent: payload.fromTransparent.slice(0, 12) + '...',
        toShielded: payload.toShielded.slice(0, 12) + '...',
        tokenAddress: payload.tokenAddress.slice(0, 12) + '...',
        amountInBase: payload.amountInBase,
      },
    })
    
    // Include the underlying error message in the error payload
    const detailedMessage = errorStack
      ? `${errorMessage}\n\nStack trace:\n${errorStack}`
      : errorMessage
    
    postError(detailedMessage, 'BUILD_SHIELDING_ERROR', error, true)
  }
}

/**
 * Handle build-unshielding request.
 */
async function handleBuildUnshielding(payload: UnshieldingBuildPayload): Promise<void> {
  if (!sdk || !isInitialized) {
    postError('SDK not initialized', 'SDK_NOT_INITIALIZED', undefined, true)
    return
  }

  try {
    const { account, gasConfig, chain, fromShielded, toTransparent, tokenAddress, amountInBase, memo } = payload

    // Log sanitized inputs
    log('info', 'Building unshielding transaction', {
      account: {
        address: account.address.slice(0, 12) + '...',
        publicKey: account.publicKey ? account.publicKey.slice(0, 16) + '...' : 'EMPTY',
        type: account.type,
      },
      gasConfig: {
        token: gasConfig.gasToken,
        gasLimit: gasConfig.gasLimit,
        gasPrice: gasConfig.gasPriceInMinDenom,
      },
      chain,
      fromShielded: fromShielded.slice(0, 12) + '...',
      toTransparent: toTransparent.slice(0, 12) + '...',
      tokenAddress,
      amountInBase,
      memo: memo ? `[${memo.length} chars]` : undefined,
    })

    // Ensure MASP params are loaded
    try {
      await sdk.masp.loadMaspParams('', chain.chainId)
    } catch (error) {
      log('warn', 'Failed to load MASP params, continuing anyway', { error: String(error) })
    }

    // Create unshielding props
    const unshieldingProps: SdkUnshieldingTransferProps = {
      source: fromShielded,
      data: [
        {
          target: toTransparent,
          token: tokenAddress,
          amount: new BigNumber(amountInBase),
        },
      ],
    }

    // Build transaction (shouldRevealPk = false for unshielding)
    const encodedTxData = await buildTx<SdkUnshieldingTransferProps>(
      account,
      gasConfig,
      chain,
      [unshieldingProps],
      sdk.tx.buildUnshieldingTransfer,
      memo,
      false, // shouldRevealPk for unshielding
    )

    log('info', 'Unshielding transaction built successfully', {
      txCount: encodedTxData.txs.length,
      txHashes: encodedTxData.txs.map((tx) => tx.hash.slice(0, 16) + '...'),
    })

    // Convert EncodedTxData<SdkUnshieldingTransferProps> to EncodedTxData<UnshieldingTransferProps>
    // by converting BigNumber amounts in data array to strings
    const convertedPayload: EncodedTxData<UnshieldingTransferProps> = {
      ...encodedTxData,
      meta: encodedTxData.meta
        ? {
            props: encodedTxData.meta.props.map((prop) => ({
              ...prop,
              data: prop.data.map((item) => ({
                ...item,
                amount:
                  item.amount instanceof BigNumber
                    ? item.amount.toString()
                    : item.amount,
              })),
            })) as UnshieldingTransferProps[],
          }
        : undefined,
    }

    post({ type: 'build-unshielding-done', payload: convertedPayload })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : undefined
    const errorCause = error instanceof Error ? error.cause : undefined

    log('error', 'Failed to build unshielding transaction', {
      error: errorMessage,
      errorStack,
      errorCause: errorCause ? String(errorCause) : undefined,
      payload: {
        account: payload.account.address.slice(0, 12) + '...',
        fromShielded: payload.fromShielded.slice(0, 12) + '...',
        toTransparent: payload.toTransparent.slice(0, 12) + '...',
        tokenAddress: payload.tokenAddress.slice(0, 12) + '...',
        amountInBase: payload.amountInBase,
      },
    })

    const detailedMessage = errorStack
      ? `${errorMessage}\n\nStack trace:\n${errorStack}`
      : errorMessage

    postError(detailedMessage, 'BUILD_UNSHIELDING_ERROR', error, true)
  }
}

/**
 * Handle build-ibc-transfer request.
 */
async function handleBuildIbcTransfer(payload: IbcBuildPayload): Promise<void> {
  if (!sdk || !isInitialized) {
    postError('SDK not initialized', 'SDK_NOT_INITIALIZED', undefined, true)
    return
  }

  try {
    const {
      account,
      gasConfig,
      chain,
      source,
      receiver,
      tokenAddress,
      amountInBase,
      portId,
      channelId,
      timeoutHeight,
      timeoutSecOffset,
      memo,
      refundTarget,
      gasSpendingKey,
    } = payload

    // Log sanitized inputs
    log('info', 'Building IBC transfer transaction', {
      account: {
        address: account.address.slice(0, 12) + '...',
        publicKey: account.publicKey ? account.publicKey.slice(0, 16) + '...' : 'EMPTY',
        type: account.type,
      },
      gasConfig: {
        token: gasConfig.gasToken,
        gasLimit: gasConfig.gasLimit,
        gasPrice: gasConfig.gasPriceInMinDenom,
      },
      chain,
      source: typeof source === 'string' ? source.slice(0, 12) + '...' : 'N/A',
      receiver,
      tokenAddress,
      amountInBase,
      portId: portId || 'transfer',
      channelId,
      memo: memo ? `[${memo.length} chars]` : undefined,
      refundTarget: refundTarget ? refundTarget.slice(0, 12) + '...' : undefined,
      hasGasSpendingKey: Boolean(gasSpendingKey),
    })

    // Ensure MASP params are loaded
    try {
      await sdk.masp.loadMaspParams('', chain.chainId)
    } catch (error) {
      log('warn', 'Failed to load MASP params, continuing anyway', { error: String(error) })
    }

    // Create IBC transfer props
    const ibcProps: SdkIbcTransferProps = {
      source,
      receiver,
      token: tokenAddress,
      amountInBaseDenom: new BigNumber(amountInBase),
      portId: portId || 'transfer',
      channelId,
      memo,
      refundTarget,
      gasSpendingKey,
      timeoutHeight: timeoutHeight ? (typeof timeoutHeight === 'string' ? BigInt(timeoutHeight) : timeoutHeight) : undefined,
      timeoutSecOffset: timeoutSecOffset ? (typeof timeoutSecOffset === 'string' ? BigInt(timeoutSecOffset) : timeoutSecOffset) : undefined,
    }

    // For IBC transfers, we don't use maspFeePaymentProps - the gasSpendingKey handles fees directly from MASP
    // Only reveal PK if no gasSpendingKey
    const shouldRevealPk = !Boolean(ibcProps.gasSpendingKey)

    // Build transaction
    const encodedTxData = await buildTx<SdkIbcTransferProps>(
      account,
      gasConfig,
      chain,
      [ibcProps],
      sdk.tx.buildIbcTransfer,
      memo,
      shouldRevealPk,
    )

    log('info', 'IBC transfer transaction built successfully', {
      txCount: encodedTxData.txs.length,
      hasRevealPk: encodedTxData.txs.some((tx) => tx.innerTxHashes.length > 1),
      txHashes: encodedTxData.txs.map((tx) => tx.hash.slice(0, 16) + '...'),
    })

    // Convert EncodedTxData<SdkIbcTransferProps> to EncodedTxData<IbcTransferProps>
    // by converting BigNumber amountInBaseDenom to string
    const convertedPayload: EncodedTxData<IbcTransferProps> = {
      ...encodedTxData,
      meta: encodedTxData.meta
        ? {
            props: encodedTxData.meta.props.map((prop) => ({
              ...prop,
              amountInBaseDenom:
                prop.amountInBaseDenom instanceof BigNumber
                  ? prop.amountInBaseDenom.toString()
                  : prop.amountInBaseDenom,
            })) as IbcTransferProps[],
          }
        : undefined,
    }

    post({ type: 'build-ibc-transfer-done', payload: convertedPayload })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : undefined
    const errorCause = error instanceof Error ? error.cause : undefined

    log('error', 'Failed to build IBC transfer transaction', {
      error: errorMessage,
      errorStack,
      errorCause: errorCause ? String(errorCause) : undefined,
      payload: {
        account: payload.account.address.slice(0, 12) + '...',
        source: typeof payload.source === 'string' ? payload.source.slice(0, 12) + '...' : 'N/A',
        receiver: payload.receiver,
        tokenAddress: payload.tokenAddress.slice(0, 12) + '...',
        amountInBase: payload.amountInBase,
      },
    })

    const detailedMessage = errorStack
      ? `${errorMessage}\n\nStack trace:\n${errorStack}`
      : errorMessage

    postError(detailedMessage, 'BUILD_IBC_TRANSFER_ERROR', error, true)
  }
}

/**
 * Handle dispose request.
 */
function handleDispose(): void {
  log('info', 'Disposing worker resources')
  isInitialized = false
  isSyncing = false
  sdk = undefined
  currentChainId = undefined
}

/**
 * Main message handler.
 */
self.onmessage = (event: MessageEvent<ShieldedWorkerRequest>) => {
  const request = event.data

  switch (request.type) {
    case 'init':
      void handleInit(request.payload)
      break
    case 'sync':
      void handleSync(request.payload)
      break
    case 'build-shielding':
      void handleBuildShielding(request.payload)
      break
    case 'build-unshielding':
      void handleBuildUnshielding(request.payload)
      break
    case 'build-ibc-transfer':
      void handleBuildIbcTransfer(request.payload)
      break
    case 'stop':
      handleStop()
      break
    case 'dispose':
      handleDispose()
      break
    default:
      log('warn', 'Unknown request type', { request })
  }
}
