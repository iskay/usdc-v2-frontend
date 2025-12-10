import { jotaiStore } from '@/store/jotaiStore'
import { customEvmChainUrlsAtom, customTendermintChainUrlsAtom } from '@/atoms/customChainUrlsAtom'
import { fetchEvmChainsConfig } from './chainConfigService'
import { fetchTendermintChainsConfig } from './tendermintChainConfigService'
import { findChainByKey, findTendermintChainByKey } from '@/config/chains'

/**
 * Get effective RPC URL for a chain with priority:
 * 1. Custom URL from atom
 * 2. Default from JSON config
 */
export async function getEffectiveRpcUrl(
  chainKey: string,
  chainType: 'evm' | 'tendermint'
): Promise<string> {
  // Check custom URLs first
  const customUrls =
    chainType === 'evm'
      ? jotaiStore.get(customEvmChainUrlsAtom)
      : jotaiStore.get(customTendermintChainUrlsAtom)

  if (customUrls[chainKey]?.rpcUrl) {
    return customUrls[chainKey].rpcUrl!
  }

  // Fall back to JSON config
  if (chainType === 'evm') {
    const config = await fetchEvmChainsConfig()
    const chain = findChainByKey(config, chainKey)
    if (chain?.rpcUrls?.[0]) {
      return chain.rpcUrls[0]
    }
    throw new Error(`RPC URL not found for EVM chain: ${chainKey}`)
  } else {
    const config = await fetchTendermintChainsConfig()
    const chain = findTendermintChainByKey(config, chainKey)
    if (chain?.rpcUrls?.[0]) {
      return chain.rpcUrls[0]
    }
    // Fallback to env variable for Namada chains
    if (chainKey === 'namada-testnet' || chainKey.startsWith('namada')) {
      const { env } = await import('@/config/env')
      return env.namadaRpc()
    }
    throw new Error(`RPC URL not found for Tendermint chain: ${chainKey}`)
  }
}

/**
 * Get effective LCD URL for a Tendermint chain with priority:
 * 1. Custom URL from atom
 * 2. Default from JSON config
 */
export async function getEffectiveLcdUrl(chainKey: string): Promise<string | undefined> {
  // Check custom URLs first
  const customUrls = jotaiStore.get(customTendermintChainUrlsAtom)
  if (customUrls[chainKey]?.lcdUrl) {
    return customUrls[chainKey].lcdUrl
  }

  // Fall back to JSON config
  const config = await fetchTendermintChainsConfig()
  const chain = findTendermintChainByKey(config, chainKey)
  return chain?.lcdUrl
}

/**
 * Get effective Indexer URL for a Tendermint chain with priority:
 * 1. Custom URL from atom
 * 2. Default from JSON config
 * 3. Environment variable (for Namada chains)
 */
export async function getEffectiveIndexerUrl(chainKey: string): Promise<string | undefined> {
  // Check custom URLs first
  const customUrls = jotaiStore.get(customTendermintChainUrlsAtom)
  if (customUrls[chainKey]?.indexerUrl) {
    return customUrls[chainKey].indexerUrl
  }

  // Fall back to JSON config
  const config = await fetchTendermintChainsConfig()
  const chain = findTendermintChainByKey(config, chainKey)
  if (chain?.indexerUrl) {
    return chain.indexerUrl
  }

  // Fallback to env variable for Namada chains
  if (chainKey === 'namada-testnet' || chainKey.startsWith('namada')) {
    const { env } = await import('@/config/env')
    return env.namadaIndexerUrl()
  }

  return undefined
}

/**
 * Get effective MASP Indexer URL for a Tendermint chain with priority:
 * 1. Custom URL from atom
 * 2. Default from JSON config
 * 3. Environment variable (for Namada chains)
 */
export async function getEffectiveMaspIndexerUrl(chainKey: string): Promise<string | undefined> {
  // Check custom URLs first
  const customUrls = jotaiStore.get(customTendermintChainUrlsAtom)
  if (customUrls[chainKey]?.maspIndexerUrl) {
    return customUrls[chainKey].maspIndexerUrl
  }

  // Fall back to JSON config
  const config = await fetchTendermintChainsConfig()
  const chain = findTendermintChainByKey(config, chainKey)
  if (chain?.maspIndexerUrl) {
    return chain.maspIndexerUrl
  }

  // Fallback to env variable for Namada chains
  if (chainKey === 'namada-testnet' || chainKey.startsWith('namada')) {
    const { env } = await import('@/config/env')
    return env.namadaMaspIndexerUrl()
  }

  return undefined
}

