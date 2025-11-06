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

export type ShieldedWorkerRequest =
  | { type: 'init'; payload: ShieldedWorkerInitPayload }
  | { type: 'sync'; payload: ShieldedWorkerSyncPayload }
  | { type: 'stop' }
  | { type: 'dispose' }

export type ShieldedWorkerLogLevel = 'info' | 'warn' | 'error'

export interface ShieldedWorkerLogPayload {
  level: ShieldedWorkerLogLevel
  message: string
  context?: Record<string, unknown>
}

export type ShieldedWorkerMessage =
  | { type: 'ready'; payload?: { chainId?: string } }
  | { type: 'progress'; payload: ShieldedSyncProgress }
  | { type: 'complete'; payload: ShieldedSyncResult }
  | { type: 'error'; payload: ShieldedWorkerErrorPayload }
  | { type: 'log'; payload: ShieldedWorkerLogPayload }

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
