/**
 * Utilities for building blockchain explorer URLs.
 */

import { fetchTendermintChainsConfig } from '@/services/config/tendermintChainConfigService'
import { fetchEvmChainsConfig } from '@/services/config/chainConfigService'
import { getDefaultNamadaChainKey, findTendermintChainByKey, findChainByKey } from '@/config/chains'
import type { TendermintChainsFile, EvmChainsFile } from '@/config/chains'

let cachedTendermintConfig: TendermintChainsFile | null = null

/**
 * Get cached or fetch Tendermint chains configuration.
 */
async function getTendermintChainsConfig(): Promise<TendermintChainsFile | null> {
  if (cachedTendermintConfig) {
    return cachedTendermintConfig
  }

  try {
    cachedTendermintConfig = await fetchTendermintChainsConfig()
    return cachedTendermintConfig
  } catch (error) {
    console.warn('[explorerUtils] Failed to fetch Tendermint chains config:', error)
    return null
  }
}

/**
 * Get Namada transaction explorer URL for a given transaction hash.
 * 
 * @param txHash - The transaction hash (will be lowercased)
 * @returns The explorer URL, or undefined if chain config is not available
 */
export async function getNamadaTxExplorerUrl(txHash: string): Promise<string | undefined> {
  const lowercasedHash = txHash.toLowerCase()
  const tendermintConfig = await getTendermintChainsConfig()
  
  if (!tendermintConfig) {
    return undefined
  }

  const namadaChainKey = getDefaultNamadaChainKey(tendermintConfig) || 'namada-testnet'
  const chain = findTendermintChainByKey(tendermintConfig, namadaChainKey)

  if (!chain?.explorer?.baseUrl) {
    return undefined
  }

  const txPath = chain.explorer.txPath ?? 'transactions'
  return `${chain.explorer.baseUrl}/${txPath}/${lowercasedHash}`
}

let cachedEvmConfig: EvmChainsFile | null = null

/**
 * Get cached or fetch EVM chains configuration.
 */
async function getEvmChainsConfig(): Promise<EvmChainsFile | null> {
  if (cachedEvmConfig) {
    return cachedEvmConfig
  }

  try {
    cachedEvmConfig = await fetchEvmChainsConfig()
    return cachedEvmConfig
  } catch (error) {
    console.warn('[explorerUtils] Failed to fetch EVM chains config:', error)
    return null
  }
}

/**
 * Get EVM transaction explorer URL for a given chain key and transaction hash.
 * 
 * @param chainKey - The EVM chain key (e.g., 'sepolia', 'base-sepolia')
 * @param txHash - The transaction hash (will be lowercased)
 * @returns The explorer URL, or undefined if chain config is not available
 */
export async function getEvmTxExplorerUrl(chainKey: string, txHash: string): Promise<string | undefined> {
  const lowercasedHash = txHash.toLowerCase()
  const evmConfig = await getEvmChainsConfig()
  
  if (!evmConfig) {
    return undefined
  }

  const chain = findChainByKey(evmConfig, chainKey)

  if (!chain?.explorer?.baseUrl) {
    return undefined
  }

  const txPath = chain.explorer.txPath ?? 'tx'
  return `${chain.explorer.baseUrl}/${txPath}/${lowercasedHash}`
}

/**
 * Get Noble transaction explorer URL for a given transaction hash.
 * 
 * @param txHash - The transaction hash (will be lowercased)
 * @returns The explorer URL, or undefined if chain config is not available
 */
export async function getNobleTxExplorerUrl(txHash: string): Promise<string | undefined> {
  const lowercasedHash = txHash.toLowerCase()
  const tendermintConfig = await getTendermintChainsConfig()
  
  if (!tendermintConfig) {
    return undefined
  }

  const chain = findTendermintChainByKey(tendermintConfig, 'noble-testnet')
  
  if (!chain?.explorer?.baseUrl) {
    return undefined
  }

  const txPath = chain.explorer.txPath ?? 'tx'
  return `${chain.explorer.baseUrl}/${txPath}/${lowercasedHash}`
}

