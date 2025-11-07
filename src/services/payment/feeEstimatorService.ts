/**
 * Fee estimator service for payment transactions.
 * Initially stubbed, can be extended to fetch from JSON endpoint.
 */

// Cache for fee estimates (chainKey -> amount -> fee)
const feeCache = new Map<string, Map<string, string>>()

/**
 * Fetch estimated fee for a payment transaction.
 * Currently stubbed to return a fixed fee.
 * 
 * @param chainKey - The chain key (e.g., 'base', 'ethereum')
 * @param amount - The payment amount (as string)
 * @returns Estimated fee as a string (e.g., "0.12")
 */
export async function fetchEstimatedFee(
  chainKey: string,
  amount: string
): Promise<string> {
  // Check cache first
  const cached = getCachedFee(chainKey, amount)
  if (cached !== null) {
    return cached
  }

  // TODO: Replace with actual API call to fetch fees from JSON endpoint
  // Example: const response = await fetch(`/api/fees?chain=${chainKey}&amount=${amount}`)
  // For now, return a stubbed fee based on chain
  const stubbedFee = getStubbedFee(chainKey, amount)

  // Cache the result
  if (!feeCache.has(chainKey)) {
    feeCache.set(chainKey, new Map())
  }
  feeCache.get(chainKey)!.set(amount, stubbedFee)

  return stubbedFee
}

/**
 * Get cached fee for a chain and amount combination.
 * 
 * @param chainKey - The chain key
 * @param amount - The payment amount
 * @returns Cached fee or null if not cached
 */
export function getCachedFee(chainKey: string, amount: string): string | null {
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
export function clearFeeCache(chainKey?: string): void {
  if (chainKey) {
    feeCache.delete(chainKey)
  } else {
    feeCache.clear()
  }
}

/**
 * Get stubbed fee based on chain and amount.
 * This is a temporary implementation until real fee estimation is available.
 * 
 * @param chainKey - The chain key
 * @param amount - The payment amount
 * @returns Stubbed fee as a string
 */
function getStubbedFee(chainKey: string, amount: string): string {
  // Base fee for all chains
  const baseFee = 0.12

  // Adjust fee based on chain (some chains may have different fee structures)
  const chainMultipliers: Record<string, number> = {
    ethereum: 1.0,
    base: 0.8,
    avalanche: 0.9,
    polygon: 0.7,
  }

  const multiplier = chainMultipliers[chainKey] ?? 1.0
  const fee = baseFee * multiplier

  // Round to 2 decimal places
  return fee.toFixed(2)
}

