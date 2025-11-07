/**
 * EVM fee estimator service for deposit transactions.
 * Estimates gas fees for EVM contract calls.
 * Initially stubbed, can be extended to fetch from JSON endpoint or estimate actual gas costs.
 */

// Cache for fee estimates (chainKey -> amount -> fee)
const feeCache = new Map<string, Map<string, string>>()

/**
 * Fetch estimated EVM fee for a deposit transaction.
 * Currently stubbed to return a fixed fee or chain-specific fees.
 * 
 * @param chainKey - The chain key (e.g., 'base', 'ethereum')
 * @param amount - The deposit amount (as string)
 * @returns Estimated fee as a string (e.g., "0.12")
 */
export async function fetchEstimatedEvmFee(
  chainKey: string,
  amount: string
): Promise<string> {
  // Check cache first
  const cached = getCachedEvmFee(chainKey, amount)
  if (cached !== null) {
    return cached
  }

  // TODO: Replace with actual API call to fetch fees from JSON endpoint
  // Example: const response = await fetch(`/api/fees/evm?chain=${chainKey}&amount=${amount}`)
  // Or estimate actual gas costs using ethers provider
  // For now, return a stubbed fee based on chain
  const stubbedFee = getStubbedEvmFee(chainKey, amount)

  // Cache the result
  if (!feeCache.has(chainKey)) {
    feeCache.set(chainKey, new Map())
  }
  feeCache.get(chainKey)!.set(amount, stubbedFee)

  return stubbedFee
}

/**
 * Get cached EVM fee for a chain and amount combination.
 * 
 * @param chainKey - The chain key
 * @param amount - The deposit amount
 * @returns Cached fee or null if not cached
 */
export function getCachedEvmFee(chainKey: string, amount: string): string | null {
  const chainCache = feeCache.get(chainKey)
  if (!chainCache) {
    return null
  }
  return chainCache.get(amount) ?? null
}

/**
 * Clear the fee cache for a specific chain or all chains.
 * 
 * @param chainKey - Optional chain key to clear. If not provided, clears all caches.
 */
export function clearEvmFeeCache(chainKey?: string): void {
  if (chainKey) {
    feeCache.delete(chainKey)
  } else {
    feeCache.clear()
  }
}

/**
 * Get stubbed EVM fee based on chain and amount.
 * This is a temporary implementation until real fee estimation is available.
 * Different chains may have different gas prices, so we adjust fees accordingly.
 * 
 * @param chainKey - The chain key
 * @param amount - The deposit amount (not used in stubbed version)
 * @returns Stubbed fee as a string
 */
function getStubbedEvmFee(chainKey: string, _amount: string): string {
  // Base fee for all chains (in USD, approximating gas costs)
  const baseFee = 0.12

  // Adjust fee based on chain (some chains have lower gas prices)
  const chainMultipliers: Record<string, number> = {
    ethereum: 1.2, // Higher gas on Ethereum
    base: 0.8, // Lower gas on Base
    avalanche: 0.9,
    polygon: 0.7, // Lower gas on Polygon
    arbitrum: 0.6, // Lower gas on Arbitrum
  }

  const multiplier = chainMultipliers[chainKey] ?? 1.0
  const fee = baseFee * multiplier

  // Round to 2 decimal places
  return fee.toFixed(2)
}

