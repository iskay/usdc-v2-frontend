import { jotaiStore } from '@/store/jotaiStore'
import {
  balanceAtom,
  balanceErrorAtom,
  balanceSyncAtom,
} from '@/atoms/balanceAtom'
import { walletAtom } from '@/atoms/walletAtom'
import { shieldedAtom } from '@/atoms/shieldedAtom'
import {
  startShieldedSync,
  getShieldedSyncStatus,
  type ShieldedSyncListeners,
} from '@/services/shielded/shieldedService'
import { getFormattedShieldedUSDCBalance } from '@/services/shielded/shieldedBalanceHelpers'
import { fetchNamadaAccounts } from '@/services/wallet/namadaKeychain'
import { resolveViewingKeyForSync } from '@/services/shielded/maspHelpers'
import { NAMADA_CHAIN_ID } from '@/config/constants'
import type { ShieldedSyncResult, ShieldedSyncProgress } from '@/types/shielded'

export interface ShieldedBalanceOptions {
  viewingKey?: string
  chainId?: string
}

let shieldedRefreshPromise: Promise<void> | null = null

/**
 * Triggers a shielded balance refresh. This uses the unified sync mechanism
 * (same as button clicks) and calculates balances after sync completes.
 * 
 * Flow:
 * 1. Check if Namada wallet is connected (early return if not)
 * 2. Check if sync is already in progress (wait for it if so)
 * 3. If no sync in progress, start sync with listeners that calculate balance on completion
 */
export function triggerShieldedBalanceRefresh(options: ShieldedBalanceOptions = {}): Promise<void> {
  if (shieldedRefreshPromise) {
    return shieldedRefreshPromise
  }

  const store = jotaiStore
  const walletState = store.get(walletAtom)

  // Check if Namada wallet is connected - early return if not
  if (!walletState.namada.isConnected) {
    console.debug('[ShieldedBalance] Skipping shielded balance refresh - Namada wallet not connected')
    return Promise.resolve()
  }

  shieldedRefreshPromise = (async () => {
    try {
      // Check if sync is already in progress
      const syncStatus = getShieldedSyncStatus()
      
      if (syncStatus.isSyncing) {
        // Wait for existing sync to complete
        console.debug('[ShieldedBalance] Sync already in progress, waiting for completion...')
        await waitForSyncCompletion()
        // Calculate balance after sync completes
        await computeShieldedBalancesAfterSync(options.chainId || NAMADA_CHAIN_ID)
        return
      }

      // No sync in progress - start a new sync with listeners
      const viewingKey = await resolveViewingKeyForSync(walletState)
      
      if (!viewingKey) {
        console.warn('[ShieldedBalance] No viewing key found, skipping sync')
        return
      }

      // Create listeners that update shieldedAtom (for loading spinner) and calculate balance on completion
      const listeners: ShieldedSyncListeners = {
        onProgress: (progress: ShieldedSyncProgress) => {
          // Update shieldedAtom (for loading spinner) - same as button click path
          const store = jotaiStore
          store.set(shieldedAtom, (state) => ({
            ...state,
            isSyncing: progress.stage !== 'complete' && progress.stage !== 'error',
            status: progress.stage,
            lastError: progress.stage === 'error' ? progress.message : undefined,
          }))
        },
        onComplete: async (result: ShieldedSyncResult) => {
          // Update shieldedAtom (for loading spinner)
          const store = jotaiStore
          store.set(shieldedAtom, (state) => ({
            ...state,
            isSyncing: false,
            status: 'complete',
            lastSyncedHeight: result.lastSyncedHeight,
            lastError: undefined,
          }))

          // Calculate balance (updates balanceSyncAtom)
          await computeShieldedBalancesAfterSync(result.chainId || NAMADA_CHAIN_ID)
        },
        onError: (error: Error) => {
          console.error('[ShieldedBalance] Sync failed:', error)
          const store = jotaiStore

          // Update shieldedAtom (for loading spinner)
          store.set(shieldedAtom, (state) => ({
            ...state,
            isSyncing: false,
            status: 'error',
            lastError: error.message,
          }))

          // Update balanceSyncAtom
          store.set(balanceErrorAtom, error.message)
          store.set(balanceSyncAtom, (state) => ({
            ...state,
            shieldedStatus: 'error',
          }))
        },
      }

      // Start sync with listeners
      await startShieldedSync(
        {
          chainId: options.chainId || NAMADA_CHAIN_ID,
          viewingKeys: [viewingKey],
          force: false,
        },
        listeners,
      )
    } catch (error) {
      console.error('[ShieldedBalance] Shielded balance refresh failed', error)
      const message = error instanceof Error ? error.message : 'Unknown shielded balance error'
      const store = jotaiStore
      store.set(balanceErrorAtom, message)
      store.set(balanceSyncAtom, (state) => ({
        ...state,
        shieldedStatus: 'error',
      }))
    } finally {
      shieldedRefreshPromise = null
    }
  })()

  return shieldedRefreshPromise
}

/**
 * Wait for shielded sync to complete by polling the sync status.
 * This is used when a sync is already in progress and we need to wait for it.
 * @param maxWaitMs - Maximum time to wait in milliseconds (default: 60 seconds)
 * @param pollIntervalMs - Polling interval in milliseconds (default: 500ms)
 */
async function waitForSyncCompletion(maxWaitMs: number = 60_000, pollIntervalMs: number = 500): Promise<void> {
  const startTime = Date.now()
  while (Date.now() - startTime < maxWaitMs) {
    const status = getShieldedSyncStatus()
    if (!status.isSyncing) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }
  throw new Error('Shielded sync timeout - sync did not complete within expected time')
}

export function isShieldedRefreshActive(): boolean {
  return Boolean(shieldedRefreshPromise)
}

/**
 * Compute and update shielded balances after sync completes.
 * This should be called when a shielded sync completes successfully.
 * @param _chainId - The chain ID (defaults to NAMADA_CHAIN_ID, currently unused but kept for API consistency)
 */
export async function computeShieldedBalancesAfterSync(_chainId: string = NAMADA_CHAIN_ID): Promise<void> {
  try {
    const store = jotaiStore
    store.set(balanceSyncAtom, (state) => ({
      ...state,
      shieldedStatus: 'calculating',
    }))

    const result = await calculateShieldedBalanceStub()
    const timestamp = Date.now()

    store.set(balanceAtom, (state) => ({
      ...state,
      namada: {
        ...state.namada,
        usdcShielded: result.usdcShielded,
        shieldedLastUpdated: timestamp,
      },
    }))

    store.set(balanceErrorAtom, undefined)
    store.set(balanceSyncAtom, (state) => ({
      ...state,
      shieldedStatus: 'idle',
      lastShieldedSuccessAt: timestamp,
    }))
  } catch (error) {
    console.error('[ShieldedBalance] Failed to compute balances after sync:', error)
    const message = error instanceof Error ? error.message : 'Unknown shielded balance error'
    const store = jotaiStore
    store.set(balanceErrorAtom, message)
    store.set(balanceSyncAtom, (state) => ({
      ...state,
      shieldedStatus: 'error',
    }))
  }
}


async function calculateShieldedBalanceStub(): Promise<{ usdcShielded: string }> {
  try {
    // Find account with viewing key
    const accounts = await fetchNamadaAccounts()
    const accountWithVk = accounts.find((a) => typeof a?.viewingKey === 'string' && a.viewingKey.length > 0)

    if (!accountWithVk?.viewingKey) {
      console.warn('[ShieldedBalance] No account with viewing key found')
      return { usdcShielded: '0.000000' }
    }

    // Query shielded USDC balance using SDK
    const formattedBalance = await getFormattedShieldedUSDCBalance(
      accountWithVk.viewingKey,
      NAMADA_CHAIN_ID,
    )

    return { usdcShielded: formattedBalance }
  } catch (error) {
    console.error('[ShieldedBalance] Failed to calculate shielded balance:', error)
    throw error
  }
}

