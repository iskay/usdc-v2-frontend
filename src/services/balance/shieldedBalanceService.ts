import { jotaiStore } from '@/store/jotaiStore'
import {
  balanceAtom,
  balanceErrorAtom,
  balanceSyncAtom,
} from '@/atoms/balanceAtom'
import { startShieldedSync } from '@/services/shielded/shieldedService'

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

async function startShieldedSyncStub(options: ShieldedBalanceOptions): Promise<void> {
  if (options.viewingKey && options.chainId) {
    await startShieldedSync({
      viewingKey: options.viewingKey,
      chainId: options.chainId,
    })
  } else {
    console.info('[ShieldedBalance] startShieldedSync skipped (missing viewing key or chain id)', options)
  }

  // TODO: replace with actual worker-based sync completion handling.
  await wait(500)
}

async function calculateShieldedBalanceStub(): Promise<{ usdcShielded: string }> {
  // TODO: Call Namada SDK shielded balance computation once available.
  await wait(1_500)
  return { usdcShielded: '--' }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

