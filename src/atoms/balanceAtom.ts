import { atom } from 'jotai'

/**
 * Balance state for the application.
 * Since we only operate on a single EVM chain at a time, we store a single EVM balance
 * that updates when the user switches networks.
 */
export interface BalanceState {
  evm: {
    usdc: string // USDC balance for the currently connected EVM chain
    chainKey?: string // The key of the EVM chain this balance is for (from evm-chains.json)
    lastUpdated?: number
  }
  namada: {
    usdcShielded: string // Shielded USDC balance on Namada
    usdcTransparent: string // Transparent USDC balance on Namada
    shieldedLastUpdated?: number
    transparentLastUpdated?: number
  }
}

export const balanceAtom = atom<BalanceState>({
  evm: {
    usdc: '--',
    chainKey: undefined,
    lastUpdated: undefined,
  },
  namada: {
    usdcShielded: '--',
    usdcTransparent: '--',
    shieldedLastUpdated: undefined,
    transparentLastUpdated: undefined,
  },
})

export const balanceErrorAtom = atom<string | undefined>(undefined)

export interface BalanceSyncState {
  status: 'idle' | 'refreshing' | 'error'
  shieldedStatus: 'idle' | 'syncing' | 'calculating' | 'error'
  lastSuccessAt?: number
  lastShieldedSuccessAt?: number
}

export const balanceSyncAtom = atom<BalanceSyncState>({
  status: 'idle',
  lastSuccessAt: undefined,
  shieldedStatus: 'idle',
  lastShieldedSuccessAt: undefined,
})

// TODO: Implement balance fetching services that update these atoms.
// TODO: Clear EVM balance when chain switches (chainKey changes).
