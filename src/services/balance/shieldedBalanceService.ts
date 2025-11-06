import { jotaiStore } from '@/store/jotaiStore'
import {
  balanceAtom,
  balanceErrorAtom,
  balanceSyncAtom,
} from '@/atoms/balanceAtom'
import { startShieldedSync, getShieldedSyncStatus } from '@/services/shielded/shieldedService'
import { getFormattedShieldedUSDCBalance } from '@/services/shielded/shieldedBalanceHelpers'
import { fetchNamadaAccounts } from '@/services/wallet/namadaKeychain'
import { NAMADA_CHAIN_ID } from '@/config/constants'

export interface ShieldedBalanceOptions {
  viewingKey?: string
  chainId?: string
}

let shieldedRefreshPromise: Promise<void> | null = null

/**
 * Triggers a shielded balance refresh. This kicks off a shielded sync and,
 * once completed, calculates the shielded balances. All heavy lifting is
 * currently stubbed but the structure mirrors the eventual Namada SDK flow.
 */
export function triggerShieldedBalanceRefresh(options: ShieldedBalanceOptions = {}): Promise<void> {
  if (shieldedRefreshPromise) {
    return shieldedRefreshPromise
  }

  const store = jotaiStore
  store.set(balanceSyncAtom, (state) => ({
    ...state,
    shieldedStatus: 'syncing',
  }))

  shieldedRefreshPromise = (async () => {
    try {
      await startShieldedSyncStub(options)

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
      console.error('Shielded balance refresh failed', error)
      const message = error instanceof Error ? error.message : 'Unknown shielded balance error'
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

export function isShieldedRefreshActive(): boolean {
  return Boolean(shieldedRefreshPromise)
}

/**
 * Compute and update shielded balances after sync completes.
 * This should be called when a shielded sync completes successfully.
 * @param chainId - The chain ID (defaults to NAMADA_CHAIN_ID)
 */
export async function computeShieldedBalancesAfterSync(chainId: string = NAMADA_CHAIN_ID): Promise<void> {
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

async function startShieldedSyncStub(options: ShieldedBalanceOptions): Promise<void> {
  if (options.viewingKey && options.chainId) {
    await startShieldedSync({
      chainId: options.chainId,
      viewingKeys: [{ key: options.viewingKey }],
    })

    // Wait for sync to complete
    await waitForSyncCompletion()
  } else {
    console.info('[ShieldedBalance] startShieldedSync skipped (missing viewing key or chain id)', options)
    // If no viewing key provided, try to find one from accounts
    const accounts = await fetchNamadaAccounts()
    const accountWithVk = accounts.find((a) => typeof a?.viewingKey === 'string' && a.viewingKey.length > 0)
    if (accountWithVk?.viewingKey) {
      await startShieldedSync({
        chainId: options.chainId || NAMADA_CHAIN_ID,
        viewingKeys: [{ key: accountWithVk.viewingKey }],
      })
      await waitForSyncCompletion()
    }
  }
}

/**
 * Wait for shielded sync to complete by polling the sync status.
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

