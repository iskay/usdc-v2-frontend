import { atom } from 'jotai'
import type { EvmChainsFile } from '@/config/chains'

export interface AppInitState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error?: string
}

export const appInitAtom = atom<AppInitState>({ status: 'idle' })
export const chainConfigAtom = atom<EvmChainsFile | undefined>(undefined)

// Store the preferred chain key for balance fetching (set by Deposit page)
// This allows the Deposit page to communicate its selected chain to the global balance service,
// which polling can then use instead of falling back to MetaMask chainId or default chain
export const preferredChainKeyAtom = atom<string | undefined>(undefined)

// Toggle to enable/disable automatic shielded sync and balance calculation during polling
// When false, polling will skip shielded operations (user can still manually trigger sync)
// Default: false (disabled)
export const autoShieldedSyncEnabledAtom = atom<boolean>(false)

// Toggle for frontend-only mode
// When enabled, transactions will not be submitted to backend for tracking
// Status will be displayed as 'undetermined' since backend tracking is unavailable
// Default: false (backend tracking enabled)
export const frontendOnlyModeAtom = atom<boolean>(false)
