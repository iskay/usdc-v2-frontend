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

/**
 * Polling timeout configuration for transaction status polling.
 * Timeout in milliseconds. If a transaction doesn't resolve within this time,
 * it will be marked as 'undetermined'.
 */
export interface PollingTimeoutConfig {
  /** Timeout in milliseconds for deposit transactions (default: 20 minutes) */
  depositTimeoutMs?: number
  /** Timeout in milliseconds for payment/send transactions (default: 20 minutes) */
  paymentTimeoutMs?: number
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
  pollingTimeout?: PollingTimeoutConfig
  pollingConfig?: PollingConfig
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

// Tendermint chain types
export interface PollingConfig {
  blockWindowBackscan?: number // Number of blocks to scan backwards on startup
}

export interface TendermintChainConfig {
  key: string
  name: string
  chainName: string // e.g., "namada", "noble"
  chainId?: string // Tendermint chain ID
  rpcUrls: string[]
  explorer?: ExplorerConfig
  pollingTimeout?: PollingTimeoutConfig
  pollingConfig?: PollingConfig
  testnet?: boolean
}

export interface TendermintChainsFile {
  chains: TendermintChainConfig[]
  defaults?: {
    namadaChainKey?: string
    nobleChainKey?: string
  }
}

/**
 * Find a Tendermint chain by key.
 * @param file - The Tendermint chains configuration file
 * @param key - The chain key
 * @returns The chain configuration, or undefined if not found
 */
export function findTendermintChainByKey(
  file: TendermintChainsFile | undefined,
  key: string
): TendermintChainConfig | undefined {
  return file?.chains.find((chain) => chain.key === key)
}

/**
 * Get the default Namada chain key from the Tendermint chains configuration.
 * @param file - The Tendermint chains configuration file
 * @returns The default Namada chain key, or undefined if not set
 */
export function getDefaultNamadaChainKey(
  file: TendermintChainsFile | undefined
): string | undefined {
  return file?.defaults?.namadaChainKey
}

/**
 * Get the default Noble chain key from the Tendermint chains configuration.
 * @param file - The Tendermint chains configuration file
 * @returns The default Noble chain key, or undefined if not set
 */
export function getDefaultNobleChainKey(
  file: TendermintChainsFile | undefined
): string | undefined {
  return file?.defaults?.nobleChainKey
}
