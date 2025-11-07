import { jotaiStore } from '@/store/jotaiStore'
import { balanceAtom, balanceErrorAtom, balanceSyncAtom } from '@/atoms/balanceAtom'
import { walletAtom } from '@/atoms/walletAtom'
import { chainConfigAtom, preferredChainKeyAtom } from '@/atoms/appAtom'
import {
  triggerShieldedBalanceRefresh,
  type ShieldedBalanceOptions,
} from '@/services/balance/shieldedBalanceService'
import { getNamadaUSDCBalance } from '@/services/namada/namadaBalanceService'
import { fetchEvmUsdcBalance } from '@/services/balance/evmBalanceService'
import { findChainByChainId, getDefaultChainKey } from '@/config/chains'

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
 * Fetches transparent USDC balance from the Namada indexer endpoint.
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
      // Get wallet state
      const walletState = store.get(walletAtom)
      const transparentAddress = walletState.namada?.account
      const metaMaskAddress = walletState.metaMask?.account
      const chainConfig = store.get(chainConfigAtom)

      // Determine chain key: use provided option, or preferred from atom, or derive from chainId, or use default
      let chainKey = options.chainKey
      if (!chainKey) {
        const preferredChainKey = store.get(preferredChainKeyAtom)
        if (preferredChainKey) {
          chainKey = preferredChainKey
        }
      }
      if (!chainKey && walletState.metaMask.chainId && chainConfig) {
        const chain = findChainByChainId(chainConfig, walletState.metaMask.chainId)
        chainKey = chain?.key
      }
      if (!chainKey && chainConfig) {
        chainKey = getDefaultChainKey(chainConfig)
      }

      // Only fetch EVM balance if MetaMask is connected and we have an address and chain key
      let evmBalance: { usdc: string; chainKey?: string } = { usdc: '--', chainKey }
      if (walletState.metaMask.isConnected && metaMaskAddress && chainKey) {
        try {
          const balance = await fetchEvmUsdcBalance(chainKey, metaMaskAddress)
          evmBalance = { usdc: balance, chainKey }
        } catch (error) {
          console.error('[BalanceService] Failed to fetch EVM balance', {
            chainKey,
            error: error instanceof Error ? error.message : String(error),
          })
          evmBalance = { usdc: '--', chainKey }
        }
      } else {
        console.debug('[BalanceService] Skipping EVM balance fetch', {
          isConnected: walletState.metaMask.isConnected,
          hasAddress: !!metaMaskAddress,
          chainKey,
        })
      }

      const transparentBalance = await fetchNamadaTransparentBalance(transparentAddress)

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

      // Only trigger shielded balance refresh if Namada wallet is connected
      if (walletState.namada.isConnected) {
        void triggerShieldedBalanceRefresh(options.shielded)
      } else {
        console.debug('[BalanceService] Skipping shielded balance refresh - Namada wallet not connected')
      }
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


/**
 * Fetch Namada transparent USDC balance from the indexer endpoint.
 * @param transparentAddress - The Namada transparent address to query, or undefined if not connected
 * @returns USDC transparent balance formatted as string, or '--' if not available
 */
async function fetchNamadaTransparentBalance(
  transparentAddress?: string
): Promise<{
  usdcTransparent: string
}> {
  if (!transparentAddress) {
    console.info('[BalanceService] No transparent address available, skipping balance fetch')
    return {
      usdcTransparent: '--',
    }
  }

  try {
    const result = await getNamadaUSDCBalance(transparentAddress)
    if (!result) {
      console.warn('[BalanceService] Failed to fetch Namada transparent balance', {
        transparentAddress,
      })
      return {
        usdcTransparent: '--',
      }
    }

    console.info('[BalanceService] Fetched Namada transparent balance', {
      transparentAddress,
      balance: result.formattedBalance,
    })

    return {
      usdcTransparent: result.formattedBalance,
    }
  } catch (error) {
    console.error('[BalanceService] Error fetching Namada transparent balance', {
      transparentAddress,
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      usdcTransparent: '--',
    }
  }
}

