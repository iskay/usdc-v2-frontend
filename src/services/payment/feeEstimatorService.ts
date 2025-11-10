/**
 * Fee estimator service for payment transactions.
 * Uses the existing Namada gas estimation service for IBC transfers.
 */

import {
  estimateGasForToken,
  fetchGasEstimateIbcUnshieldingTransfer,
} from '@/services/namada/namadaFeeEstimatorService'
import { getUSDCAddressFromRegistry } from '@/services/namada/namadaBalanceService'
import { env } from '@/config/env'
import { logger } from '@/utils/logger'
import BigNumber from 'bignumber.js'
import type { GasConfig } from '@/types/shielded'

// Cache for fee estimates (chainKey -> amount -> fee)
const feeCache = new Map<string, Map<string, string>>()

/**
 * Fetch estimated fee for a payment transaction.
 * Uses the existing Namada gas estimation service for IBC transfers.
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

  try {
    // Get USDC token address
    const usdcToken = await getUSDCAddressFromRegistry()
    if (!usdcToken) {
      logger.warn('[FeeEstimator] USDC token address not found, using stubbed fee')
      return getStubbedFee(chainKey, amount)
    }

    // Estimate gas for IBC transfer
    const gas = await estimateGasForToken(usdcToken, ['IbcTransfer'], '90000')

    // Calculate fee: gasLimit * gasPrice / token decimals
    // USDC has 6 decimals, but gas is paid in NAM which has different decimals
    // For display purposes, we'll convert to a reasonable USD estimate
    // This is a simplified calculation - actual fee depends on NAM price
    const gasLimit = new BigNumber(gas.gasLimit)
    const gasPrice = new BigNumber(gas.gasPriceInMinDenom)
    const totalGasCost = gasLimit.multipliedBy(gasPrice)

    // Convert to a display-friendly fee estimate
    // This is approximate - actual fee will vary based on NAM price and token decimals
    // For now, we'll use a base estimate and adjust based on gas cost
    const baseFee = 0.12
    const gasMultiplier = totalGasCost.dividedBy(1e6).toNumber() // Normalize for display
    const estimatedFee = Math.max(baseFee, baseFee * (1 + gasMultiplier * 0.1))

    const feeString = estimatedFee.toFixed(2)

    // Cache the result
    if (!feeCache.has(chainKey)) {
      feeCache.set(chainKey, new Map())
    }
    feeCache.get(chainKey)!.set(amount, feeString)

    logger.debug('[FeeEstimator] Estimated fee for payment', {
      chainKey,
      amount,
      fee: feeString,
      gasLimit: gas.gasLimit,
      gasPrice: gas.gasPriceInMinDenom,
    })

    return feeString
  } catch (error) {
    logger.warn('[FeeEstimator] Failed to estimate fee, using stubbed fee', {
      error: error instanceof Error ? error.message : String(error),
      chainKey,
      amount,
    })
    // Fallback to stubbed fee on error
    return getStubbedFee(chainKey, amount)
  }
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
function getStubbedFee(chainKey: string, _amount: string): string {
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

/**
 * Payment fee information for display purposes.
 */
export interface PaymentFeeInfo {
  feeAmount: string
  feeToken: 'USDC' | 'NAM'
  finalAmount: string
  gasConfig: GasConfig
}

/**
 * Estimate payment fee for display purposes using indexer gas estimate.
 * This uses the same logic as payment transaction building but returns display-friendly information.
 *
 * @param transparentAddress - The transparent address
 * @param shieldedAddress - The shielded address (optional, for optimization)
 * @param amountInDisplayUnits - The amount in display units (optional, for future use)
 * @returns Fee information including fee amount, token, and final amount after fees
 */
export async function estimatePaymentFeeForDisplay(
  transparentAddress: string,
  shieldedAddress?: string,
  amountInDisplayUnits?: string,
): Promise<PaymentFeeInfo> {
  logger.debug('[FeeEstimator] Estimating payment fee for display', {
    transparent: transparentAddress.slice(0, 12) + '...',
    shielded: shieldedAddress ? shieldedAddress.slice(0, 12) + '...' : undefined,
    amount: amountInDisplayUnits,
  })

  // Get USDC token address
  const usdcToken = await getUSDCAddressFromRegistry()
  if (!usdcToken) {
    throw new Error('USDC token address not found. Please configure VITE_USDC_TOKEN_ADDRESS')
  }

  // Get NAM token address (fallback)
  const namAddr = env.namadaToken() || null
  const gasTokenCandidate = usdcToken || namAddr || ''

  // Fetch gas estimate from indexer for IBC unshielding transfer
  const estimate = await fetchGasEstimateIbcUnshieldingTransfer()

  // Estimate gas for IBC transfer using indexer estimate as fallback
  const gas = await estimateGasForToken(
    gasTokenCandidate,
    ['IbcTransfer'],
    String(estimate.avg || 75000),
  )

  // Calculate fee amount (gasLimit × gasPrice)
  const gasLimitBN = new BigNumber(gas.gasLimit)
  const gasPriceBN = new BigNumber(gas.gasPriceInMinDenom)
  const feeInMinDenom = gasLimitBN.multipliedBy(gasPriceBN)

  // Convert fee to display units (both USDC and NAM use 6 decimals)
  const feeInDisplayUnits = feeInMinDenom.dividedBy(new BigNumber(10).pow(6))

  // Determine fee token display name
  const feeToken: 'USDC' | 'NAM' = gas.gasToken === usdcToken ? 'USDC' : 'NAM'

  // Calculate final amount after fees (if fees are paid in USDC, subtract from amount)
  let finalAmountBN = new BigNumber(0)
  if (amountInDisplayUnits) {
    const amountBN = new BigNumber(amountInDisplayUnits)
    if (feeToken === 'USDC') {
      finalAmountBN = BigNumber.max(amountBN.minus(feeInDisplayUnits), 0)
    } else {
      finalAmountBN = amountBN
    }
  }

  const feeInfo: PaymentFeeInfo = {
    feeAmount: feeInDisplayUnits.toFixed(6),
    feeToken,
    finalAmount: finalAmountBN.toFixed(6),
    gasConfig: gas,
  }

  logger.debug('[FeeEstimator] Payment fee estimation for display complete', {
    feeAmount: feeInfo.feeAmount,
    feeToken: feeInfo.feeToken,
    finalAmount: feeInfo.finalAmount,
    gasToken: gas.gasToken.slice(0, 12) + '...',
    gasLimit: gas.gasLimit,
    gasPrice: gas.gasPriceInMinDenom,
  })

  return feeInfo
}

