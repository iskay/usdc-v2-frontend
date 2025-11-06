import type { EvmChainsFile } from '@/config/chains'
import { fetchEvmChainsConfig } from '@/services/config/chainConfigService'
import { startBalancePolling } from '@/services/balance/balanceService'

export interface BootstrapResult {
  chains: EvmChainsFile
}

export async function initializeApplication(): Promise<BootstrapResult> {
  const chains = await fetchEvmChainsConfig()

  // Start periodic balance refresh loop (stubbed fetch logic for now).
  startBalancePolling({ intervalMs: 10_000, runImmediate: true })

  // TODO: Restore persisted wallet + settings state before reconnect attempts.
  // TODO: Attempt MetaMask reconnection, prefetch balances, etc.
  // TODO: Initialize Namada SDK workers + shielded sync prerequisites.

  return { chains }
}
