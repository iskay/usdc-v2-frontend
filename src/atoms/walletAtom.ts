import { atom } from 'jotai'

export interface WalletState {
  metaMask: {
    isConnecting: boolean
    isConnected: boolean
    account?: string
    chainId?: number
    chainHex?: string
  }
  namada: {
    isConnecting: boolean
    isConnected: boolean
    account?: string
    shieldedAccount?: string
    alias?: string
    viewingKey?: string
  }
  lastUpdated?: number
}

export const walletAtom = atom<WalletState>({
  metaMask: {
    isConnecting: false,
    isConnected: false,
    account: undefined,
    chainId: undefined,
    chainHex: undefined,
  },
  namada: {
    isConnecting: false,
    isConnected: false,
    account: undefined,
    shieldedAccount: undefined,
    alias: undefined,
    viewingKey: undefined,
  },
  lastUpdated: undefined,
})

export const walletErrorAtom = atom<string | undefined>(undefined)

// Note: Balances are stored separately in balanceAtom.
// TODO: Extend wallet state with chain metadata and keychain capabilities.
