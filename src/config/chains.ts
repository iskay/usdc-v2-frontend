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

/**
 * Find a chain by chain ID (numeric).
 * @param file - The chains configuration file
 * @param chainId - The numeric chain ID
 * @returns The chain configuration, or undefined if not found
 */
export function findChainByChainId(
  file: EvmChainsFile | undefined,
  chainId: number
): EvmChainConfig | undefined {
  return file?.chains.find((chain) => chain.chainId === chainId)
}

/**
 * Get the default chain key from the chains configuration.
 * @param file - The chains configuration file
 * @returns The default chain key, or undefined if not set
 */
export function getDefaultChainKey(file: EvmChainsFile | undefined): string | undefined {
  return file?.defaults?.selectedChainKey
}
