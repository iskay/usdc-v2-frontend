/// <reference lib="webworker" />

import { initSdk } from '@namada/sdk-multicore/inline'
import { SdkEvents, ProgressBarNames } from '@namada/sdk-multicore'
import type { Sdk } from '@namada/sdk-multicore'
import type {
  ShieldedWorkerRequest,
  ShieldedWorkerMessage,
  ShieldedWorkerInitPayload,
  ShieldedWorkerSyncPayload,
  ShieldedSyncProgress,
  ShieldedSyncResult,
  ShieldedWorkerErrorPayload,
  ShieldedWorkerLogPayload,
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
