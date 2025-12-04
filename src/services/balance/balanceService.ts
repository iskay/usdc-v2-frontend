import { jotaiStore } from '@/store/jotaiStore'
import { balanceAtom, balanceErrorAtom, balanceSyncAtom, balanceErrorsAtom } from '@/atoms/balanceAtom'
import { walletAtom } from '@/atoms/walletAtom'
import { chainConfigAtom, preferredChainKeyAtom, autoShieldedSyncEnabledAtom } from '@/atoms/appAtom'
import {
  triggerShieldedBalanceRefresh,
  type ShieldedBalanceOptions,
} from '@/services/balance/shieldedBalanceService'
import { getNamadaUSDCBalance } from '@/services/namada/namadaBalanceService'
import { fetchEvmUsdcBalance } from '@/services/balance/evmBalanceService'
import { findChainByChainId, findChainByKey, getDefaultChainKey } from '@/config/chains'

const DEFAULT_POLL_INTERVAL_MS = 10_000

type BalanceRefreshTrigger = 'init' | 'manual' | 'poll'

export type BalanceType = 'evm' | 'namadaTransparent' | 'namadaShielded'

export interface BalanceRefreshOptions {
  trigger?: BalanceRefreshTrigger
  chainKey?: string
  shielded?: ShieldedBalanceOptions
  /**
   * Optional array of balance types to fetch. If not provided, all balance types will be fetched.
   * This allows selective refresh of specific balance types for better performance.
   */
  balanceTypes?: BalanceType[]
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
      // Default to all balance types if not specified (backward compatible)
      const balanceTypes = options.balanceTypes ?? ['evm', 'namadaTransparent', 'namadaShielded']
      const shouldFetchEvm = balanceTypes.includes('evm')
      const shouldFetchNamadaTransparent = balanceTypes.includes('namadaTransparent')
      const shouldFetchNamadaShielded = balanceTypes.includes('namadaShielded')

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

      // Validate chain key exists in config before fetching balance
      const chainExists = chainKey && chainConfig ? findChainByKey(chainConfig, chainKey) !== undefined : false

      // Fetch EVM balance if requested
      let evmBalance: { usdc: string; chainKey?: string } | undefined
      if (shouldFetchEvm) {
        evmBalance = { usdc: '--', chainKey }
        if (walletState.metaMask.isConnected && metaMaskAddress && chainKey && chainExists) {
          try {
            const balance = await fetchEvmUsdcBalance(chainKey, metaMaskAddress)
            evmBalance = { usdc: balance, chainKey }
            // Clear EVM error on success
            store.set(balanceErrorsAtom, (state) => {
              const { evm, ...rest } = state
              return rest
            })
            store.set(balanceSyncAtom, (state) => ({
              ...state,
              evmStatus: 'idle',
            }))
          } catch (error) {
            console.error('[BalanceService] Failed to fetch EVM balance', {
              chainKey,
              error: error instanceof Error ? error.message : String(error),
            })
            evmBalance = { usdc: '--', chainKey }
            const errorMessage = error instanceof Error ? error.message : 'Unknown EVM balance error'
            store.set(balanceErrorsAtom, (state) => ({
              ...state,
              evm: errorMessage,
            }))
            store.set(balanceSyncAtom, (state) => ({
              ...state,
              evmStatus: 'error',
            }))
          }
        } else {
          console.debug('[BalanceService] Skipping EVM balance fetch', {
            isConnected: walletState.metaMask.isConnected,
            hasAddress: !!metaMaskAddress,
            chainKey,
            chainExists,
          })
          // Clear EVM error if we're skipping (not an error condition)
          store.set(balanceErrorsAtom, (state) => {
            const { evm, ...rest } = state
            return rest
          })
          store.set(balanceSyncAtom, (state) => ({
            ...state,
            evmStatus: 'idle',
          }))
        }
      }

      // Fetch Namada transparent balance if requested
      let transparentBalance: { usdcTransparent: string } | undefined
      if (shouldFetchNamadaTransparent) {
        try {
        transparentBalance = await fetchNamadaTransparentBalance(transparentAddress)
          // Clear transparent error on success
          if (transparentBalance && transparentBalance.usdcTransparent !== '--') {
            store.set(balanceErrorsAtom, (state) => {
              const { transparent, ...rest } = state
              return rest
            })
            store.set(balanceSyncAtom, (state) => ({
              ...state,
              transparentStatus: 'idle',
            }))
          }
        } catch (error) {
          console.error('[BalanceService] Failed to fetch transparent balance', {
            transparentAddress,
            error: error instanceof Error ? error.message : String(error),
          })
          transparentBalance = { usdcTransparent: '--' }
          const errorMessage = error instanceof Error ? error.message : 'Unknown transparent balance error'
          store.set(balanceErrorsAtom, (state) => ({
            ...state,
            transparent: errorMessage,
          }))
          store.set(balanceSyncAtom, (state) => ({
            ...state,
            transparentStatus: 'error',
          }))
        }
      }

      const completedAt = Date.now()

      // Update balance atom with fetched values (preserve existing values for types not fetched)
      store.set(balanceAtom, (state) => ({
        evm: evmBalance
          ? {
              usdc: evmBalance.usdc ?? state.evm.usdc,
              chainKey: evmBalance.chainKey ?? state.evm.chainKey,
              lastUpdated: completedAt,
            }
          : state.evm,
        namada: {
          ...state.namada,
          usdcTransparent: transparentBalance
            ? transparentBalance.usdcTransparent ?? state.namada.usdcTransparent
            : state.namada.usdcTransparent,
          transparentLastUpdated: transparentBalance ? completedAt : state.namada.transparentLastUpdated,
        },
      }))
      // Only clear error if it's not a shielded balance calculation error
      // Shielded balance errors should persist until the shielded balance calculation succeeds
      const currentSyncState = store.get(balanceSyncAtom)
      if (currentSyncState.shieldedStatus !== 'error') {
      store.set(balanceErrorAtom, undefined)
      }
      store.set(balanceSyncAtom, (state) => ({
        ...state,
        status: 'idle',
        lastSuccessAt: completedAt,
      }))

      // Fetch Namada shielded balance if requested
      if (shouldFetchNamadaShielded) {
        // Only trigger shielded balance refresh if Namada wallet is connected
        // Skip shielded sync during polling if auto-sync is disabled (manual sync button still works)
        const isPolling = options.trigger === 'poll'
        const autoSyncEnabled = store.get(autoShieldedSyncEnabledAtom)
        const shouldSkipShieldedSync = isPolling && !autoSyncEnabled

        if (walletState.namada.isConnected) {
          if (shouldSkipShieldedSync) {
            console.debug('[BalanceService] Skipping shielded balance refresh - auto-sync disabled during polling')
          } else {
            void triggerShieldedBalanceRefresh(options.shielded)
          }
        } else {
          console.debug('[BalanceService] Skipping shielded balance refresh - Namada wallet not connected')
        }
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

    const result = await getNamadaUSDCBalance(transparentAddress)
    if (!result) {
      console.warn('[BalanceService] Failed to fetch Namada transparent balance', {
        transparentAddress,
      })
    throw new Error('Could not query transparent balance from chain')
    }

    return {
      usdcTransparent: result.formattedBalance,
  }
}

