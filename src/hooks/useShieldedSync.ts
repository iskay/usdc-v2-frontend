import { useCallback, useEffect, useRef } from 'react'
import { useAtom } from 'jotai'
import { shieldedAtom, shieldedProgressAtom } from '@/atoms/shieldedAtom'
import { walletAtom } from '@/atoms/walletAtom'
import {
  startShieldedSync,
  stopShieldedSync,
  getShieldedSyncStatus,
  type ShieldedSyncListeners,
} from '@/services/shielded/shieldedService'
import { resolveViewingKeyForSync } from '@/services/shielded/maspHelpers'
import { NAMADA_CHAIN_ID } from '@/config/constants'
import { computeShieldedBalancesAfterSync } from '@/services/balance/shieldedBalanceService'
import type { ShieldedSyncProgress, ShieldedSyncResult } from '@/types/shielded'

export function useShieldedSync() {
  const [shieldedState, setShieldedState] = useAtom(shieldedAtom)
  const [, setProgress] = useAtom(shieldedProgressAtom)
  const [walletState] = useAtom(walletAtom)
  const listenersRef = useRef<ShieldedSyncListeners | null>(null)

  // Setup listeners
  useEffect(() => {
    const listeners: ShieldedSyncListeners = {
      onProgress: (progress: ShieldedSyncProgress) => {
        // Update progress percentage
        if (typeof progress.current === 'number' && typeof progress.total === 'number' && progress.total > 0) {
          const percentage = Math.min(100, Math.max(0, Math.round((progress.current / progress.total) * 100)))
          setProgress(percentage)
        }

        // Update state with stage
        setShieldedState((state) => ({
          ...state,
          isSyncing: progress.stage !== 'complete' && progress.stage !== 'error',
          status: progress.stage,
          lastError: progress.stage === 'error' ? progress.message : undefined,
        }))
      },
      onComplete: async (result: ShieldedSyncResult) => {
        setShieldedState((state) => ({
          ...state,
          isSyncing: false,
          status: 'complete',
          lastSyncedHeight: result.lastSyncedHeight,
          lastError: undefined,
        }))
        setProgress(100)

        // Compute and update shielded balances after sync completes
        try {
          await computeShieldedBalancesAfterSync(NAMADA_CHAIN_ID)
        } catch (error) {
          console.error('[useShieldedSync] Failed to compute balances after sync:', error)
        }
      },
      onError: (error: Error) => {
        setShieldedState((state) => ({
          ...state,
          isSyncing: false,
          status: 'error',
          lastError: error.message,
        }))
        setProgress(0)
      },
      onLog: (level: 'info' | 'warn' | 'error', message: string, context?: Record<string, unknown>) => {
        if (level === 'error') {
          console.error('[ShieldedSync]', message, context)
        } else if (level === 'warn') {
          console.warn('[ShieldedSync]', message, context)
        } else {
          console.debug('[ShieldedSync]', message, context)
        }
      },
    }

    listenersRef.current = listeners

    return () => {
      // Cleanup listeners on unmount
      if (listenersRef.current) {
        // Note: The controller will handle listener removal when sync completes
        listenersRef.current = null
      }
    }
  }, [setShieldedState, setProgress])

  const startSync = useCallback(async () => {
    try {
      // Check if Namada wallet is connected
      if (!walletState.namada.isConnected) {
        throw new Error('Namada wallet not connected')
      }

      // Resolve viewing key using shared helper
      const viewingKey = await resolveViewingKeyForSync(walletState)

      if (!viewingKey) {
        throw new Error('No Namada account with viewing key found. Please ensure your account has a viewing key.')
      }

      // Update state to show syncing
      setShieldedState((state) => ({
        ...state,
        isSyncing: true,
        status: 'initializing',
        lastError: undefined,
      }))
      setProgress(0)

      // Start sync with listeners
      await startShieldedSync(
        {
          chainId: NAMADA_CHAIN_ID,
          viewingKeys: [viewingKey],
          force: false,
        },
        listenersRef.current || undefined,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start shielded sync'
      setShieldedState((state) => ({
        ...state,
        isSyncing: false,
        status: 'error',
        lastError: message,
      }))
      setProgress(0)
      console.error('[useShieldedSync] Failed to start sync:', error)
    }
  }, [walletState.namada.isConnected, walletState.namada.viewingKey, setShieldedState, setProgress])

  const stopSync = useCallback(() => {
    stopShieldedSync()
    setShieldedState((state) => ({
      ...state,
      isSyncing: false,
      status: 'idle',
    }))
    setProgress(0)
  }, [setShieldedState, setProgress])

  // Sync status with controller on mount
  useEffect(() => {
    const status = getShieldedSyncStatus()
    if (status.isInitialized || status.isSyncing) {
      setShieldedState((state) => ({
        ...state,
        isSyncing: status.isSyncing,
        status: status.isSyncing ? 'syncing' : 'idle',
      }))
    }
  }, [setShieldedState])

  // Check if wallet is connected - viewing key will be fetched from accounts in startSync
  const isReady = walletState.namada.isConnected

  return {
    state: shieldedState,
    startSync,
    stopSync,
    isReady,
  }
}
