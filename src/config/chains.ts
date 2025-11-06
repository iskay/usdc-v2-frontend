export interface ExplorerConfig {
  baseUrl: string
  txPath?: string
  addressPath?: string
}

export interface NativeCurrencyConfig {
  name: string
  symbol: string
  decimals: number
}

export interface ChainContractsConfig {
  usdc: string
  tokenMessenger: string
  messageTransmitter?: string
  [contract: string]: string | undefined
}

export interface GaslessConfig {
  enabled: boolean
  zeroExChainId?: number
  zeroExBaseUrl?: string
}

export interface EstimatedTimesConfig {
  deposit?: string
  send?: string
}

export interface EvmChainConfig {
  key: string
  name: string
  chainId: number
  chainIdHex: string
  cctpDomain: number
  rpcUrls: string[]
  explorer: ExplorerConfig
  nativeCurrency: NativeCurrencyConfig
  contracts: ChainContractsConfig
  gasless?: GaslessConfig
  estimatedTimes?: EstimatedTimesConfig
  logo?: string
  testnet?: boolean
}

export interface EvmChainsFile {
  chains: EvmChainConfig[]
  defaults?: {
    selectedChainKey?: string
  }
}

export function findChainByKey(file: EvmChainsFile | undefined, key: string): EvmChainConfig | undefined {
  return file?.chains.find((chain) => chain.key === key)
}
