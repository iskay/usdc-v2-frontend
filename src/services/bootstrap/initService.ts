import type { EvmChainsFile } from '@/config/chains'
import { fetchEvmChainsConfig } from '@/services/config/chainConfigService'
import { startBalancePolling } from '@/services/balance/balanceService'
import { initializeNamadaSdk } from '@/services/namada/namadaSdkService'
import {
  attemptMetaMaskReconnection,
  attemptNamadaReconnection,
  registerNamadaAccountChangeListener,
} from '@/services/wallet/walletService'
import { loadCustomChainUrls } from '@/services/storage/customChainUrlsStorage'
import { jotaiStore } from '@/store/jotaiStore'
import { customEvmChainUrlsAtom, customTendermintChainUrlsAtom } from '@/atoms/customChainUrlsAtom'

export interface BootstrapResult {
  chains: EvmChainsFile
}

export async function initializeApplication(): Promise<BootstrapResult> {
  // Load custom chain URLs from localStorage before loading chain configs
  const storedUrls = loadCustomChainUrls()
  if (storedUrls) {
    if (storedUrls.evm && Object.keys(storedUrls.evm).length > 0) {
      jotaiStore.set(customEvmChainUrlsAtom, storedUrls.evm)
    }
    if (storedUrls.tendermint && Object.keys(storedUrls.tendermint).length > 0) {
      jotaiStore.set(customTendermintChainUrlsAtom, storedUrls.tendermint)
    }
  }

  const chains = await fetchEvmChainsConfig()

  // Initialize Namada SDK early in the bootstrap process
  try {
    await initializeNamadaSdk()
    console.info('[Bootstrap] Namada SDK initialized successfully')
  } catch (error) {
    console.error('[Bootstrap] Namada SDK initialization failed:', error)
    // Don't fail bootstrap if SDK init fails - app can still work for EVM-only flows
    // Error is logged but bootstrap continues
  }

  // Start periodic balance refresh loop
  startBalancePolling({ intervalMs: 10_000, runImmediate: true })

  // Register Namada account change listener (stays active for app lifetime)
  registerNamadaAccountChangeListener()

  // Attempt to reconnect to wallets if already connected (non-interactive)
  // These run in parallel and silently fail - they won't block app initialization
  await Promise.allSettled([
    attemptMetaMaskReconnection(),
    attemptNamadaReconnection(),
  ])

  return { chains }
}
