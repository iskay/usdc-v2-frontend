/**
 * Namada fee estimator service for gas estimation.
 * Prioritizes USDC token for gas payment, falls back to NAM if USDC is not available.
 */

import BigNumber from 'bignumber.js'
import { env } from '@/config/env'
import { logger } from '@/utils/logger'
import type { GasConfig } from '@/types/shielded'
import { getUSDCAddressFromRegistry } from './namadaBalanceService'

/**
 * Get the Namada indexer URL from environment.
 */
function getIndexerUrl(): string {
  return env.namadaIndexerUrl() || 'https://indexer.testnet.siuuu.click'
}

/**
 * Gas estimate response from indexer.
 */
export interface GasEstimate {
  min: number
  avg: number
  max: number
  totalEstimates: number
}

/**
 * Fetch gas estimate for specific transaction kinds from indexer.
 */
async function fetchGasEstimateForKinds(txKinds: string[]): Promise<GasEstimate> {
  const counters: Record<string, number> = {}
  for (const kind of txKinds) {
    counters[kind] = (counters[kind] || 0) + 1
  }

  // Build query params matching Namadillo's indexer client format
  const params = new URLSearchParams({
    bond: String(counters['Bond'] || 0),
    claimRewards: String(counters['ClaimRewards'] || 0),
    unbond: String(counters['Unbond'] || 0),
    transparentTransfer: String(counters['TransparentTransfer'] || 0),
    shieldedTransfer: String(counters['ShieldedTransfer'] || 0),
    shieldingTransfer: String(counters['ShieldingTransfer'] || 0),
    unshieldingTransfer: String(counters['UnshieldingTransfer'] || 0),
    voteProposal: String(counters['VoteProposal'] || 0),
    ibcTransfer: String(counters['IbcTransfer'] || 0),
    withdraw: String(counters['Withdraw'] || 0),
    revealPk: String(counters['RevealPk'] || 0),
    redelegate: String(counters['Redelegate'] || 0),
  })

  const url = `${getIndexerUrl()}/api/v1/gas/estimate?${params.toString()}`
  try {
    logger.debug('[NamadaFeeEstimator] Fetching gas estimate', { url, txKinds })
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(`Indexer HTTP ${res.status}`)
    }
    const data = await res.json()
    const estimate: GasEstimate = {
      min: Number((data && (data.min ?? data.Min)) ?? 50000),
      avg: Number((data && (data.avg ?? data.Avg)) ?? 50000),
      max: Number((data && (data.max ?? data.Max)) ?? 50000),
      totalEstimates: Number((data && (data.totalEstimates ?? data.TotalEstimates)) ?? 0),
    }
    logger.debug('[NamadaFeeEstimator] Gas estimate fetched', estimate)
    return estimate
  } catch (error) {
    logger.warn('[NamadaFeeEstimator] Failed to fetch gas estimate, using fallback', {
      error: error instanceof Error ? error.message : String(error),
      txKinds,
    })
    return { min: 50000, avg: 50000, max: 50000, totalEstimates: 0 }
  }
}

/**
 * Check if a token address is valid for gas payment and get its gas price.
 */
async function fetchGasPriceForTokenAddress(
  tokenAddress: string,
): Promise<{ isValid: boolean; minDenomAmount?: string }> {
  const url = `${getIndexerUrl()}/api/v1/gas-price/${tokenAddress}`
  try {
    logger.debug('[NamadaFeeEstimator] Fetching gas price for token', {
      tokenAddress: tokenAddress.slice(0, 12) + '...',
    })
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(`Indexer HTTP ${res.status}`)
    }
    const data = await res.json()
    if (Array.isArray(data) && data.length > 0) {
      const first = data[0] || {}
      const minDenomAmount = String(first?.minDenomAmount ?? '')
      const result = {
        isValid: true,
        minDenomAmount: minDenomAmount || undefined,
      }
      logger.debug('[NamadaFeeEstimator] Gas price fetched', {
        tokenAddress: tokenAddress.slice(0, 12) + '...',
        isValid: result.isValid,
        minDenomAmount: result.minDenomAmount,
      })
      return result
    }
    return { isValid: false }
  } catch (error) {
    logger.debug('[NamadaFeeEstimator] Failed to fetch gas price for token', {
      tokenAddress: tokenAddress.slice(0, 12) + '...',
      error: error instanceof Error ? error.message : String(error),
    })
    // Treat failures as not valid to allow fallback to NAM
    return { isValid: false }
  }
}

/**
 * Get NAM token address from environment variables.
 * Uses VITE_NAMADA_NAM_TOKEN env var with a default fallback.
 */
function getNAMAddressFromEnv(): string | null {
  const namAddress = env.namadaToken()
  if (namAddress && typeof namAddress === 'string' && namAddress.trim()) {
    return namAddress.trim()
  }
  return null
}

/**
 * Estimate gas for a given token and transaction kinds.
 * Prioritizes USDC token for gas payment, falls back to NAM if USDC is not available.
 *
 * @param candidateToken - The preferred token address (typically USDC)
 * @param txKinds - Array of transaction kinds (e.g., ['ShieldingTransfer', 'RevealPk'])
 * @param fallbackGasLimit - Fallback gas limit if estimation fails (default: '50000')
 * @returns Gas configuration with token, limit, and price
 */
export async function estimateGasForToken(
  candidateToken: string,
  txKinds: string[],
  fallbackGasLimit = '50000',
): Promise<GasConfig> {
  logger.debug('[NamadaFeeEstimator] Estimating gas', {
    candidateToken: candidateToken.slice(0, 12) + '...',
    txKinds,
    fallbackGasLimit,
  })

  let selectedGasToken = candidateToken
  let gasPriceInMinDenom = new BigNumber('0.000001') // Default for NAM

  // Try to use candidate token (USDC) first
  try {
    const validity = await fetchGasPriceForTokenAddress(candidateToken)
    if (validity?.isValid && validity.minDenomAmount) {
      // Use the actual gas price from the indexer
      gasPriceInMinDenom = new BigNumber(validity.minDenomAmount)
      logger.info('[NamadaFeeEstimator] Using candidate token for gas', {
        token: candidateToken.slice(0, 12) + '...',
        gasPrice: gasPriceInMinDenom.toString(),
      })
    } else {
      // Fallback to NAM token
      logger.info('[NamadaFeeEstimator] Candidate token not valid for gas, falling back to NAM', {
        candidateToken: candidateToken.slice(0, 12) + '...',
      })
      const namAddr = getNAMAddressFromEnv()
      selectedGasToken = namAddr || candidateToken
      // Get gas price for NAM token
      const namValidity = await fetchGasPriceForTokenAddress(selectedGasToken)
      if (namValidity?.isValid && namValidity.minDenomAmount) {
        gasPriceInMinDenom = new BigNumber(namValidity.minDenomAmount)
        logger.info('[NamadaFeeEstimator] Using NAM token for gas', {
          token: selectedGasToken.slice(0, 12) + '...',
          gasPrice: gasPriceInMinDenom.toString(),
        })
      } else {
        logger.warn('[NamadaFeeEstimator] NAM token gas price not found, using default', {
          token: selectedGasToken.slice(0, 12) + '...',
        })
      }
    }
  } catch (error) {
    logger.warn('[NamadaFeeEstimator] Error checking token validity, falling back to NAM', {
      error: error instanceof Error ? error.message : String(error),
      candidateToken: candidateToken.slice(0, 12) + '...',
    })
    const namAddr = getNAMAddressFromEnv()
    selectedGasToken = namAddr || candidateToken
    // Keep default gas price for NAM
  }

  // Fetch gas limit estimate
  try {
    const estimate = await fetchGasEstimateForKinds(txKinds)
    const gasLimit = new BigNumber(estimate?.avg ?? fallbackGasLimit)
    const result: GasConfig = {
      gasToken: selectedGasToken,
      gasLimit: gasLimit.toString(),
      gasPriceInMinDenom: gasPriceInMinDenom.toString(),
    }
    logger.info('[NamadaFeeEstimator] Gas estimation complete', {
      gasToken: result.gasToken.slice(0, 12) + '...',
      gasLimit: result.gasLimit,
      gasPrice: result.gasPriceInMinDenom,
      txKinds,
    })
    return result
  } catch (error) {
    logger.warn('[NamadaFeeEstimator] Gas estimation failed, using fallback defaults', {
      error: error instanceof Error ? error.message : String(error),
      txKinds,
    })
    return {
      gasToken: selectedGasToken,
      gasLimit: fallbackGasLimit,
      gasPriceInMinDenom: gasPriceInMinDenom.toString(),
    }
  }
}

/**
 * Estimate gas for shielding transaction with optional RevealPK.
 * This is a convenience function that automatically includes RevealPK in tx kinds if needed.
 *
 * @param usdcTokenAddress - USDC token address (will be used as candidate for gas payment)
 * @param needsRevealPk - Whether RevealPK transaction is needed
 * @param fallbackGasLimit - Fallback gas limit if estimation fails
 * @returns Gas configuration
 */
export async function estimateShieldingGas(
  usdcTokenAddress: string,
  needsRevealPk = false,
  fallbackGasLimit = '50000',
): Promise<GasConfig> {
  const txKinds: string[] = ['ShieldingTransfer']
  if (needsRevealPk) {
    txKinds.unshift('RevealPk')
  }

  logger.debug('[NamadaFeeEstimator] Estimating shielding gas', {
    usdcTokenAddress: usdcTokenAddress.slice(0, 12) + '...',
    needsRevealPk,
    txKinds,
  })

  // Try to get USDC address from registry if not provided
  let candidateToken = usdcTokenAddress
  if (!candidateToken) {
    const usdcAddr = await getUSDCAddressFromRegistry()
    if (usdcAddr) {
      candidateToken = usdcAddr
      logger.debug('[NamadaFeeEstimator] Using USDC address from registry', {
        address: candidateToken.slice(0, 12) + '...',
      })
    } else {
      // Fallback to NAM
      const namAddr = getNAMAddressFromEnv()
      candidateToken = namAddr || ''
      logger.debug('[NamadaFeeEstimator] USDC not found, using NAM', {
        address: candidateToken ? candidateToken.slice(0, 12) + '...' : 'N/A',
      })
    }
  }

  return estimateGasForToken(candidateToken, txKinds, fallbackGasLimit)
}

