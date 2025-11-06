// @ts-ignore - Vite worker import
import ShieldedSyncWorker from './worker?worker'
import type {
  ShieldedWorkerRequest,
  ShieldedWorkerMessage,
  ShieldedWorkerInitPayload,
  ShieldedWorkerSyncPayload,
  ShieldedSyncProgress,
  ShieldedSyncResult,
  ShieldedViewingKey,
} from '@/types/shielded'
import { env } from '@/config/env'
import { getNamadaSdk } from '@/services/namada/namadaSdkService'

export interface ShieldedSyncParams {
  chainId: string
  viewingKeys: ShieldedViewingKey[]
  force?: boolean
}

export type ShieldedSyncProgressCallback = (progress: ShieldedSyncProgress) => void
export type ShieldedSyncCompleteCallback = (result: ShieldedSyncResult) => void
export type ShieldedSyncErrorCallback = (error: Error) => void
export type ShieldedSyncLogCallback = (level: 'info' | 'warn' | 'error', message: string, context?: Record<string, unknown>) => void

export interface ShieldedSyncListeners {
  onProgress?: ShieldedSyncProgressCallback
  onComplete?: ShieldedSyncCompleteCallback
  onError?: ShieldedSyncErrorCallback
  onLog?: ShieldedSyncLogCallback
}

class ShieldedSyncController {
  private worker: Worker | null = null
  private isInitialized = false
  private isSyncing = false
  private initPromise: Promise<void> | null = null
  private syncPromise: Promise<void> | null = null
  private listeners: Set<ShieldedSyncListeners> = new Set()
  private currentChainId: string | undefined

  /**
   * Get the worker instance, creating it if necessary.
   */
  private getWorker(): Worker {
    if (this.worker) {
      return this.worker
    }

    // Use Vite's worker import syntax
    this.worker = new ShieldedSyncWorker()

    this.worker.addEventListener('message', this.handleWorkerMessage.bind(this))
    this.worker.addEventListener('error', this.handleWorkerError.bind(this))

    return this.worker
  }

  /**
   * Handle messages from the worker.
   */
  private handleWorkerMessage(event: MessageEvent<ShieldedWorkerMessage>): void {
    const message = event.data

    switch (message.type) {
      case 'ready':
        this.isInitialized = true
        this.currentChainId = message.payload?.chainId
        this.notifyListeners((listeners) => {
          listeners.onLog?.('info', 'Worker initialized', { chainId: this.currentChainId })
        })
        break

      case 'progress':
        this.notifyListeners((listeners) => {
          listeners.onProgress?.(message.payload)
        })
        break

      case 'complete':
        this.isSyncing = false
        this.notifyListeners((listeners) => {
          listeners.onComplete?.(message.payload)
          listeners.onLog?.('info', 'Shielded sync completed', {
            chainId: message.payload.chainId,
            viewingKeyCount: message.payload.viewingKeyCount,
          })
        })
        break

      case 'error':
        this.isSyncing = false
        const error = new Error(message.payload.message)
        if (message.payload.code) {
          ;(error as Error & { code?: string }).code = message.payload.code
        }
        this.notifyListeners((listeners) => {
          listeners.onError?.(error)
          listeners.onLog?.('error', 'Shielded sync error', {
            message: message.payload.message,
            code: message.payload.code,
            recoverable: message.payload.recoverable,
          })
        })
        break

      case 'log':
        this.notifyListeners((listeners) => {
          listeners.onLog?.(message.payload.level, message.payload.message, message.payload.context)
        })
        break

      default:
        console.warn('[ShieldedSyncController] Unknown worker message type', message)
    }
  }

  /**
   * Handle worker errors.
   */
  private handleWorkerError(event: ErrorEvent): void {
    const error = new Error(`Worker error: ${event.message}`)
    this.isSyncing = false
    this.notifyListeners((listeners) => {
      listeners.onError?.(error)
      listeners.onLog?.('error', 'Worker error', { message: event.message, filename: event.filename, lineno: event.lineno })
    })
  }

  /**
   * Notify all listeners.
   */
  private notifyListeners(fn: (listeners: ShieldedSyncListeners) => void): void {
    this.listeners.forEach(fn)
  }

  /**
   * Initialize the worker with SDK configuration.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized && this.initPromise) {
      return this.initPromise
    }

    if (this.initPromise) {
      return this.initPromise
    }

    this.initPromise = (async () => {
      try {
        // Ensure SDK is initialized (for config access)
        await getNamadaSdk()

        const worker = this.getWorker()

        const initPayload: ShieldedWorkerInitPayload = {
          rpcUrl: env.namadaRpc(),
          token: env.namadaToken(),
          maspIndexerUrl: env.namadaMaspIndexerUrl(),
          dbName: env.namadaDbName(),
        }

        const request: ShieldedWorkerRequest = {
          type: 'init',
          payload: initPayload,
        }

        // Wait for ready message
        const readyPromise = new Promise<void>((resolve, reject) => {
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
        })

        worker.postMessage(request)
        await readyPromise

        this.isInitialized = true
      } catch (error) {
        this.isInitialized = false
        this.initPromise = null
        throw error
      }
    })()

    return this.initPromise
  }

  /**
   * Start a shielded sync operation.
   */
  async startSync(params: ShieldedSyncParams, listeners?: ShieldedSyncListeners): Promise<void> {
    if (listeners) {
      this.listeners.add(listeners)
    }

    // Deduplicate concurrent sync requests
    if (this.isSyncing && this.syncPromise) {
      return this.syncPromise
    }

    // Ensure worker is initialized
    if (!this.isInitialized) {
      await this.initialize()
    }

    this.syncPromise = (async () => {
      try {
        this.isSyncing = true
        const worker = this.getWorker()

        const syncPayload: ShieldedWorkerSyncPayload = {
          chainId: params.chainId,
          viewingKeys: params.viewingKeys,
          force: params.force,
        }

        const request: ShieldedWorkerRequest = {
          type: 'sync',
          payload: syncPayload,
        }

        // Wait for complete or error message
        const syncPromise = new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Shielded sync timeout'))
          }, 300000) // 5 minute timeout

          const handler = (event: MessageEvent<ShieldedWorkerMessage>) => {
            if (event.data.type === 'complete') {
              clearTimeout(timeout)
              worker.removeEventListener('message', handler)
              resolve()
            } else if (event.data.type === 'error' && event.data.payload.code === 'SYNC_ERROR') {
              clearTimeout(timeout)
              worker.removeEventListener('message', handler)
              reject(new Error(event.data.payload.message))
            }
          }

          worker.addEventListener('message', handler)
        })

        worker.postMessage(request)
        await syncPromise
      } finally {
        this.isSyncing = false
        this.syncPromise = null
        if (listeners) {
          this.listeners.delete(listeners)
        }
      }
    })()

    return this.syncPromise
  }

  /**
   * Stop the current sync operation.
   */
  stopSync(): void {
    if (!this.isSyncing || !this.worker) {
      return
    }

    const request: ShieldedWorkerRequest = { type: 'stop' }
    this.worker.postMessage(request)
  }

  /**
   * Remove a listener set.
   */
  removeListeners(listeners: ShieldedSyncListeners): void {
    this.listeners.delete(listeners)
  }

  /**
   * Dispose of the worker and clean up resources.
   */
  dispose(): void {
    if (this.worker) {
      const request: ShieldedWorkerRequest = { type: 'dispose' }
      this.worker.postMessage(request)
      this.worker.terminate()
      this.worker = null
    }

    this.isInitialized = false
    this.isSyncing = false
    this.initPromise = null
    this.syncPromise = null
    this.listeners.clear()
    this.currentChainId = undefined
  }

  /**
   * Get the current sync status.
   */
  getStatus(): { isInitialized: boolean; isSyncing: boolean; chainId?: string } {
    return {
      isInitialized: this.isInitialized,
      isSyncing: this.isSyncing,
      chainId: this.currentChainId,
    }
  }
}

// Singleton instance
const controller = new ShieldedSyncController()

// Cleanup on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    controller.dispose()
  })
}

/**
 * Start a shielded sync operation.
 */
export async function startShieldedSync(
  params: ShieldedSyncParams,
  listeners?: ShieldedSyncListeners,
): Promise<void> {
  return controller.startSync(params, listeners)
}

/**
 * Stop the current shielded sync operation.
 */
export function stopShieldedSync(): void {
  controller.stopSync()
}

/**
 * Get the current sync status.
 */
export function getShieldedSyncStatus(): { isInitialized: boolean; isSyncing: boolean; chainId?: string } {
  return controller.getStatus()
}

/**
 * Dispose of the shielded sync controller.
 */
export function disposeShieldedSync(): void {
  controller.dispose()
}

/**
 * Initialize the shielded sync controller.
 */
export async function initializeShieldedSync(): Promise<void> {
  return controller.initialize()
}
