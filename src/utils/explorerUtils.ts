/**
 * Utilities for building blockchain explorer URLs.
 */

import { fetchTendermintChainsConfig } from '@/services/config/tendermintChainConfigService'
import { getDefaultNamadaChainKey, findTendermintChainByKey } from '@/config/chains'
import type { TendermintChainsFile } from '@/config/chains'

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

