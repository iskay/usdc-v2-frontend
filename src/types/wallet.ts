export interface EvmWalletInfo {
  address: string
  chainId?: number
  chainIdHex?: string
  chainName?: string
}

export interface NamadaWalletInfo {
  transparentAddress?: string
  shieldedAddress?: string
  accountAlias?: string
  viewingKey?: string
}

export type WalletConnection = {
  evm?: EvmWalletInfo
  namada?: NamadaWalletInfo
  connectedAt: number
}

export interface AppSettings {
  preferredEvmChain?: string
  preferredTheme: 'light' | 'dark' | 'system'
  enableNotifications: boolean
}

// Note: Balances are stored separately in balanceAtom.
// TODO: Extend with multi-account support.
