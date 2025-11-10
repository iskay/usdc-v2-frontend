export type ShieldedSyncStage =
  | 'idle'
  | 'initializing'
  | 'loading-params'
  | 'syncing'
  | 'finalizing'
  | 'complete'
  | 'error'

export interface ShieldedSyncState {
  isSyncing: boolean
  status?: ShieldedSyncStage
  lastSyncedHeight?: number
  lastError?: string
}

export interface ShieldedViewingKey {
  key: string
  birthday?: number
}

export interface ShieldedWorkerInitPayload {
  rpcUrl: string
  token: string
  maspIndexerUrl?: string
  paramsUrl?: string
  dbName?: string
}

export interface ShieldedSyncRequest {
  chainId: string
  viewingKeys: ShieldedViewingKey[]
  force?: boolean
  startHeight?: number
}

export type ShieldedWorkerSyncPayload = ShieldedSyncRequest

export interface ShieldedSyncProgress {
  stage: ShieldedSyncStage
  current?: number
  total?: number
  step?: string
  message?: string
}

export interface ShieldedSyncResult {
  chainId: string
  completedAt: number
  lastSyncedHeight?: number
  viewingKeyCount: number
}

export interface ShieldedWorkerErrorPayload {
  message: string
  code?: string
  cause?: unknown
  recoverable?: boolean
}

export interface GasConfig {
  gasToken: string
  gasLimit: string
  gasPriceInMinDenom: string
}

export interface ChainSettings {
  chainId: string
  nativeTokenAddress: string
}

export interface ShieldingParams {
  transparent: string
  shielded: string
  tokenAddress: string
  amountInBase: string
  gas: GasConfig
  chain: ChainSettings
  publicKey?: string
  memo?: string
}

export interface ShieldingBuildPayload {
  account: {
    address: string
    publicKey: string
    type?: string
  }
  gasConfig: GasConfig
  chain: ChainSettings
  fromTransparent: string
  toShielded: string
  tokenAddress: string
  amountInBase: string
  memo?: string
}

export interface ShieldingTransactionData {
  transparent: string
  shielded: string
  tokenAddress: string
  amountInBase: string
  gasToken: string
  chainId: string
  memo?: string
}

// EncodedTxData from SDK (matches mockup structure)
export interface EncodedTxData<T = unknown> {
  type: string
  txs: Array<{
    args: unknown
    hash: string
    bytes: Uint8Array
    signingData: unknown
    innerTxHashes: string[]
    memos: (number[] | null)[]
  }>
  wrapperTxProps: {
    token: string
    feeAmount: string
    gasLimit: string
    chainId: string
    publicKey?: string
    memo?: string
  }
  meta?: {
    props: T[]
  }
}

export interface ShieldingBuildResult {
  encodedTxData: EncodedTxData
  txHash?: string
}

// export type ShieldedWorkerRequest =
//   | { type: 'init'; payload: ShieldedWorkerInitPayload }
//   | { type: 'sync'; payload: ShieldedWorkerSyncPayload }
//   | { type: 'build-shielding'; payload: ShieldingBuildPayload }
//   | { type: 'stop' }
//   | { type: 'dispose' }

export type ShieldedWorkerLogLevel = 'info' | 'warn' | 'error'

export interface ShieldedWorkerLogPayload {
  level: ShieldedWorkerLogLevel
  message: string
  context?: Record<string, unknown>
}

// export type ShieldedWorkerMessage =
//   | { type: 'ready'; payload?: { chainId?: string } }
//   | { type: 'progress'; payload: ShieldedSyncProgress }
//   | { type: 'complete'; payload: ShieldedSyncResult }
//   | { type: 'build-shielding-done'; payload: EncodedTxData }
//   | { type: 'error'; payload: ShieldedWorkerErrorPayload }
//   | { type: 'log'; payload: ShieldedWorkerLogPayload }

export const DEFAULT_SHIELDED_WORKER_FALLBACK = 'shielded/worker.ts'

export interface ShieldedWorkerAssetOptions {
  envPath?: string | null
  fallback?: string
  baseUrl?: string
}

export function resolveShieldedWorkerAssetPath({
  envPath,
  fallback = DEFAULT_SHIELDED_WORKER_FALLBACK,
  baseUrl,
}: ShieldedWorkerAssetOptions = {}): string {
  const trimmedEnvPath = envPath?.trim()
  if (trimmedEnvPath) {
    return trimmedEnvPath
  }

  const effectiveFallback = (fallback ?? DEFAULT_SHIELDED_WORKER_FALLBACK).trim()
  if (baseUrl && baseUrl.trim()) {
    const normalizedBase = baseUrl.trim().replace(/\/+$/, '')
    const normalizedFallback = effectiveFallback.replace(/^\/+/, '')
    if (!normalizedBase) {
      return normalizedFallback
    }
    return `${normalizedBase}/${normalizedFallback}`
  }

  return effectiveFallback
}

// Unshielding Transfer Types
export interface UnshieldingTransferDataProps {
  target: string
  token: string
  amount: string | number
}

export interface UnshieldingTransferProps {
  source: string
  data: UnshieldingTransferDataProps[]
}

// IBC Transfer Types
export interface IbcTransferProps {
  source: string
  receiver: string
  token: string
  amountInBaseDenom: string | number
  portId: string
  channelId: string
  timeoutHeight?: bigint | string
  timeoutSecOffset?: bigint | string
  memo?: string
  refundTarget?: string
  gasSpendingKey?: string
}

// Unshielding Service Types
export interface UnshieldingParams {
  fromShielded: string
  toTransparent: string
  tokenAddress: string
  amountInBase: string
  gas: GasConfig
  chain: ChainSettings
  memo?: string
}

export interface UnshieldingBuildPayload {
  account: {
    address: string
    publicKey: string
    type?: string
  }
  gasConfig: GasConfig
  chain: ChainSettings
  fromShielded: string
  toTransparent: string
  tokenAddress: string
  amountInBase: string
  memo?: string
}

// IBC Transfer Service Types
export interface IbcParams {
  ownerAddress: string
  accountPublicKey: string
  source: string
  receiver: string
  tokenAddress: string
  amountInBase: string
  gas: GasConfig
  chain: ChainSettings
  channelId: string
  portId?: string
  timeoutHeight?: bigint | string
  timeoutSecOffset?: bigint | string
  memo?: string
  refundTarget?: string
  gasSpendingKey?: string
}

export interface IbcBuildPayload {
  account: {
    address: string
    publicKey: string
    type?: string
  }
  gasConfig: GasConfig
  chain: ChainSettings
  source: string
  receiver: string
  tokenAddress: string
  amountInBase: string
  portId?: string
  channelId: string
  timeoutHeight?: bigint | string
  timeoutSecOffset?: bigint | string
  memo?: string
  refundTarget?: string
  gasSpendingKey?: string
}

// Payment Transaction Types
export interface PaymentTransactionData {
  amount: string
  destinationAddress: string
  destinationChain: string
  destinationDomain: number
  orbiterMemo: string
  ibcParams: IbcParams
  refundTarget?: string
  disposableSignerAddress?: string
  disposableSignerPublicKey?: string
  encodedTxData?: EncodedTxData<IbcTransferProps>
}

// Extended Worker Message Types
export type ShieldedWorkerRequest =
  | { type: 'init'; payload: ShieldedWorkerInitPayload }
  | { type: 'sync'; payload: ShieldedWorkerSyncPayload }
  | { type: 'build-shielding'; payload: ShieldingBuildPayload }
  | { type: 'build-unshielding'; payload: UnshieldingBuildPayload }
  | { type: 'build-ibc-transfer'; payload: IbcBuildPayload }
  | { type: 'stop' }
  | { type: 'dispose' }

export type ShieldedWorkerMessage =
  | { type: 'ready'; payload?: { chainId?: string } }
  | { type: 'progress'; payload: ShieldedSyncProgress }
  | { type: 'complete'; payload: ShieldedSyncResult }
  | { type: 'build-shielding-done'; payload: EncodedTxData }
  | { type: 'build-unshielding-done'; payload: EncodedTxData<UnshieldingTransferProps> }
  | { type: 'build-ibc-transfer-done'; payload: EncodedTxData<IbcTransferProps> }
  | { type: 'error'; payload: ShieldedWorkerErrorPayload }
  | { type: 'log'; payload: ShieldedWorkerLogPayload }
