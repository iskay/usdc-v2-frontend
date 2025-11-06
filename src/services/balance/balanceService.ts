import { jotaiStore } from '@/store/jotaiStore'
import { balanceAtom, balanceErrorAtom, balanceSyncAtom } from '@/atoms/balanceAtom'
import {
  triggerShieldedBalanceRefresh,
  type ShieldedBalanceOptions,
} from '@/services/balance/shieldedBalanceService'

const DEFAULT_POLL_INTERVAL_MS = 10_000

type BalanceRefreshTrigger = 'init' | 'manual' | 'poll'

export interface BalanceRefreshOptions {
  trigger?: BalanceRefreshTrigger
  chainKey?: string
  shielded?: ShieldedBalanceOptions
}

let pollingHandle: ReturnType<typeof setInterval> | undefined
let inflightRefresh: Promise<void> | null = null

/**
 * Triggers a balance refresh and updates Jotai atoms with the fetched values.
 * The actual fetching logic is stubbed for now and should be replaced once the
 * wallet + SDK integrations are implemented.
 */
export async function refreshBalances(options: BalanceRefreshOptions = {}): Promise<void> {
  if (inflightRefresh) {
    return inflightRefresh
  }

  const store = jotaiStore
  store.set(balanceSyncAtom, (state) => ({
    ...state,
    status: 'refreshing',
  }))

  inflightRefresh = (async () => {
    try {
      const [evmBalance, transparentBalance] = await Promise.all([
        fetchEvmBalanceStub(options.chainKey),
        fetchNamadaTransparentBalanceStub(),
      ])

      const completedAt = Date.now()

      store.set(balanceAtom, (state) => ({
        evm: {
          usdc: evmBalance.usdc ?? state.evm.usdc,
          chainKey: evmBalance.chainKey ?? state.evm.chainKey,
          lastUpdated: completedAt,
        },
        namada: {
          ...state.namada,
          usdcTransparent: transparentBalance.usdcTransparent ?? state.namada.usdcTransparent,
          transparentLastUpdated: completedAt,
        },
      }))
      store.set(balanceErrorAtom, undefined)
      store.set(balanceSyncAtom, (state) => ({
        ...state,
        status: 'idle',
        lastSuccessAt: completedAt,
      }))

      void triggerShieldedBalanceRefresh(options.shielded)
    } catch (error) {
      console.error('Balance refresh failed', error)
      const message = error instanceof Error ? error.message : 'Unknown balance refresh error'
      store.set(balanceErrorAtom, message)
      store.set(balanceSyncAtom, (state) => ({
        ...state,
        status: 'error',
      }))
    }
  })()

  try {
    await inflightRefresh
  } finally {
    inflightRefresh = null
  }
}

/**
 * Starts polling balances at a fixed interval. Subsequent calls are ignored
 * until `stopBalancePolling` is invoked.
 */
export function startBalancePolling(options: { intervalMs?: number; runImmediate?: boolean } = {}): void {
  if (pollingHandle) {
    return
  }

  const intervalMs = Math.max(options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS, 1_000)

  if (options.runImmediate !== false) {
    void refreshBalances({ trigger: 'init' })
  }

  pollingHandle = setInterval(() => {
    void refreshBalances({ trigger: 'poll' })
  }, intervalMs)
}

export function stopBalancePolling(): void {
  if (!pollingHandle) {
    return
  }

  clearInterval(pollingHandle)
  pollingHandle = undefined
}

export function isBalancePollingActive(): boolean {
  return Boolean(pollingHandle)
}

export function requestBalanceRefresh(options: BalanceRefreshOptions = {}): Promise<void> {
  return refreshBalances({ ...options, trigger: options.trigger ?? 'manual' })
}

async function fetchEvmBalanceStub(chainKey?: string): Promise<{
  usdc: string
  chainKey?: string
}> {
  // TODO: Replace with actual EVM wallet balance retrieval using walletService + RPC provider.
  console.info('[BalanceService] Fetching EVM balance (stub)', { chainKey })
  return {
    usdc: '--',
    chainKey,
  }
}

async function fetchNamadaTransparentBalanceStub(): Promise<{
  usdcTransparent: string
}> {
  // TODO: Replace with Namada transparent balance HTTP fetch.
  console.info('[BalanceService] Fetching Namada transparent balance (stub)')
  return {
    usdcTransparent: '--',
  }
}

