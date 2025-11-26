/**
 * Block Height Lookup Service
 * 
 * Provides abstracted methods to fetch block height from creation timestamp for different chains.
 * Each chain implements its own lookup method, but all provide the same interface:
 * getStartHeight(chainKey, creationTimestampMs, blockWindowBackscan) -> startHeight
 */

import { logger } from '@/utils/logger'
import { retryWithBackoff } from './basePoller'
import { fetchTendermintChainsConfig } from '@/services/config/tendermintChainConfigService'
import { fetchEvmChainsConfig } from '@/services/config/chainConfigService'

/**
 * Cache for chain configs
 */
let tendermintConfigsCache: Awaited<ReturnType<typeof fetchTendermintChainsConfig>> | null = null
let evmConfigsCache: Awaited<ReturnType<typeof fetchEvmChainsConfig>> | null = null

/**
 * Default block window backscan values (blocks to scan backwards)
 * Used as fallback if not specified in chain config
 */
const DEFAULT_BLOCK_WINDOW_BACKSCAN: Record<string, number> = {
  'namada-testnet': 20,
  'noble-testnet': 50,
  'sepolia': 50,
  'ethereum': 50,
  // Add more defaults as needed
}

/**
 * Get block window backscan for a chain from config files
 * 
 * @param chainKey - Chain key (e.g., 'namada-testnet', 'noble-testnet', 'sepolia')
 * @returns Block window backscan value
 */
async function getBlockWindowBackscan(chainKey: string): Promise<number> {
  try {
    // Check Tendermint chains first
    if (!tendermintConfigsCache) {
      tendermintConfigsCache = await fetchTendermintChainsConfig()
    }
    
    const tendermintChain = tendermintConfigsCache.chains.find((c) => c.key === chainKey)
    if (tendermintChain?.pollingConfig?.blockWindowBackscan !== undefined) {
      return tendermintChain.pollingConfig.blockWindowBackscan
    }

    // Check EVM chains (for future support)
    if (!evmConfigsCache) {
      evmConfigsCache = await fetchEvmChainsConfig()
    }
    
    const evmChain = evmConfigsCache.chains.find((c) => c.key === chainKey)
    if (evmChain?.pollingConfig?.blockWindowBackscan !== undefined) {
      return evmChain.pollingConfig.blockWindowBackscan
    }

    // Fallback to defaults
    return DEFAULT_BLOCK_WINDOW_BACKSCAN[chainKey] ?? 50
  } catch (error) {
    logger.warn('[BlockHeightLookup] Failed to load chain config, using default backscan', {
      chainKey,
      error: error instanceof Error ? error.message : String(error),
    })
    // Fallback to defaults
    return DEFAULT_BLOCK_WINDOW_BACKSCAN[chainKey] ?? 50
  }
}

/**
 * Namada-specific block height lookup using indexer endpoint
 * 
 * @param creationTimestampMs - Creation timestamp in milliseconds
 * @param blockWindowBackscan - Number of blocks to scan backwards
 * @returns Start height for polling
 */
async function getNamadaStartHeight(
  creationTimestampMs: number,
  blockWindowBackscan: number,
): Promise<number> {
  // Convert milliseconds to seconds (indexer expects seconds)
  const timestampSeconds = Math.floor(creationTimestampMs / 1000)

  // Namada testnet indexer endpoint
  const indexerUrl = 'https://indexer.testnet.siuuu.click/api/v1/block/timestamp'
  const url = `${indexerUrl}/${timestampSeconds}`

  logger.debug('[BlockHeightLookup] Fetching Namada block height from indexer', {
    timestampMs: creationTimestampMs,
    timestampSeconds,
    url,
  })

  try {
    const response = await retryWithBackoff(
      async () => {
        const res = await fetch(url, {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
        })

        if (!res.ok) {
          throw new Error(`Indexer API returned ${res.status}: ${res.statusText}`)
        }

        return res.json()
      },
      3, // max retries
      500, // initial delay
      5000, // max delay
    )

    const blockHeight = response.height as number
    if (!blockHeight || blockHeight <= 0) {
      throw new Error(`Invalid block height returned from indexer: ${blockHeight}`)
    }

    // Subtract backscan window
    const startHeight = Math.max(0, blockHeight - blockWindowBackscan)

    logger.info('[BlockHeightLookup] Namada start height calculated', {
      creationTimestampMs,
      timestampSeconds,
      blockHeight,
      blockWindowBackscan,
      startHeight,
    })

    return startHeight
  } catch (error) {
    logger.error('[BlockHeightLookup] Failed to fetch Namada block height from indexer', {
      timestampMs: creationTimestampMs,
      timestampSeconds,
      url,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

/**
 * EVM-specific block height lookup (stubbed)
 * 
 * @param chainKey - EVM chain key (e.g., 'sepolia')
 * @param creationTimestampMs - Creation timestamp in milliseconds
 * @param blockWindowBackscan - Number of blocks to scan backwards
 * @returns Start height for polling
 */
async function getEvmStartHeight(
  chainKey: string,
  creationTimestampMs: number,
  blockWindowBackscan: number,
): Promise<number> {
  // TODO: Implement EVM block height lookup from timestamp
  // Options:
  // 1. Use ethers.js provider.getBlock() with timestamp
  // 2. Use chain-specific indexer/explorer API
  // 3. Use block number estimation based on average block time
  
  logger.warn('[BlockHeightLookup] EVM start height lookup not yet implemented', {
    chainKey,
    creationTimestampMs,
    blockWindowBackscan,
  })

  // For now, return 0 to indicate we should use latest block minus backscan
  // This matches current behavior in evmPoller.ts
  return 0
}

/**
 * Noble-specific block height lookup (stubbed)
 * 
 * @param creationTimestampMs - Creation timestamp in milliseconds
 * @param blockWindowBackscan - Number of blocks to scan backwards
 * @returns Start height for polling
 */
async function getNobleStartHeight(
  creationTimestampMs: number,
  blockWindowBackscan: number,
): Promise<number> {
  // TODO: Implement Noble block height lookup from timestamp
  // Options:
  // 1. Use Tendermint RPC client to query blocks by timestamp
  // 2. Use chain-specific indexer/explorer API
  // 3. Use block height estimation based on average block time
  
  logger.warn('[BlockHeightLookup] Noble start height lookup not yet implemented', {
    creationTimestampMs,
    blockWindowBackscan,
  })

  // For now, return 0 to indicate we should use latest block minus backscan
  // This matches current behavior in noblePoller.ts
  return 0
}

/**
 * Get start height for polling based on creation timestamp
 * 
 * This is the main entry point for fetching block height from timestamp.
 * It abstracts away chain-specific implementations and applies the backscan window.
 * 
 * @param chainKey - Chain key (e.g., 'namada-testnet', 'noble-testnet', 'sepolia')
 * @param creationTimestampMs - Transaction creation timestamp in milliseconds
 * @param blockWindowBackscan - Optional block window backscan (defaults to chain-specific value)
 * @returns Start height for polling (block height minus backscan window)
 */
export async function getStartHeightFromTimestamp(
  chainKey: string,
  creationTimestampMs: number,
  blockWindowBackscan?: number,
): Promise<number> {
  const backscan = blockWindowBackscan ?? await getBlockWindowBackscan(chainKey)

  logger.debug('[BlockHeightLookup] Getting start height from timestamp', {
    chainKey,
    creationTimestampMs,
    blockWindowBackscan: backscan,
  })

  try {
    // Route to chain-specific implementation
    if (chainKey === 'namada-testnet' || chainKey.startsWith('namada')) {
      return await getNamadaStartHeight(creationTimestampMs, backscan)
    } else if (chainKey === 'noble-testnet' || chainKey.startsWith('noble')) {
      return await getNobleStartHeight(creationTimestampMs, backscan)
    } else if (
      chainKey === 'sepolia' ||
      chainKey === 'ethereum' ||
      chainKey.startsWith('evm-') ||
      // Add other EVM chain detection logic as needed
      chainKey.match(/^0x[a-fA-F0-9]+$/) // Hex chain ID
    ) {
      return await getEvmStartHeight(chainKey, creationTimestampMs, backscan)
    } else {
      logger.warn('[BlockHeightLookup] Unknown chain key, using fallback', {
        chainKey,
        creationTimestampMs,
      })
      // Fallback: return 0 to indicate we should use latest block minus backscan
      return 0
    }
  } catch (error) {
    logger.error('[BlockHeightLookup] Failed to get start height from timestamp', {
      chainKey,
      creationTimestampMs,
      error: error instanceof Error ? error.message : String(error),
    })
    // Fallback: return 0 to indicate we should use latest block minus backscan
    return 0
  }
}

/**
 * Check if a chain supports timestamp-based block height lookup
 * 
 * @param chainKey - Chain key
 * @returns True if lookup is implemented, false if stubbed
 */
export function supportsTimestampLookup(chainKey: string): boolean {
  if (chainKey === 'namada-testnet' || chainKey.startsWith('namada')) {
    return true // Namada is implemented
  }
  // EVM and Noble are stubbed
  return false
}

