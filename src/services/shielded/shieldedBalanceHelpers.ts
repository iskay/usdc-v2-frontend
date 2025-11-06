import type { Sdk } from '@namada/sdk-multicore'
import { getNamadaSdk } from '@/services/namada/namadaSdkService'
import { getUSDCAddressFromRegistry } from '@/services/namada/namadaBalanceService'
import { NAMADA_CHAIN_ID } from '@/config/constants'

/**
 * Format a min denom amount to a human-readable string.
 * @param amountMinDenom - The amount in minimum denomination (as string)
 * @param decimals - Number of decimal places (default: 6 for USDC)
 * @returns Formatted balance string
 */
export function formatMinDenom(amountMinDenom: string, decimals: number = 6): string {
  try {
    const amount = BigInt(amountMinDenom)
    const divisor = BigInt(10 ** decimals)
    const whole = amount / divisor
    const fractional = amount % divisor
    const fractionalStr = fractional.toString().padStart(decimals, '0')
    return `${whole}.${fractionalStr}`
  } catch {
    return '0.000000'
  }
}

/**
 * Query shielded balances for a given viewing key and token addresses.
 * @param viewingKey - The viewing key to query
 * @param tokenAddresses - Array of token addresses to query
 * @param chainId - The chain ID (defaults to NAMADA_CHAIN_ID)
 * @returns Array of [tokenAddress, balance] tuples
 */
export async function queryShieldedBalances(
  viewingKey: string,
  tokenAddresses: string[],
  chainId: string = NAMADA_CHAIN_ID,
): Promise<[string, string][]> {
  try {
    if (!tokenAddresses || tokenAddresses.length === 0) {
      return []
    }

    const sdk = getNamadaSdk()
    // SDK RPC queryBalance method signature: queryBalance(viewingKey, tokenAddresses, chainId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const balances = await (sdk.rpc as any).queryBalance(viewingKey, tokenAddresses, chainId) as [string, string][]
    return balances || []
  } catch (error) {
    console.error('[ShieldedBalanceHelpers] Failed to query shielded balances:', error)
    return []
  }
}

/**
 * Query shielded USDC balance for a given viewing key.
 * @param viewingKey - The viewing key to query
 * @param chainId - The chain ID (defaults to NAMADA_CHAIN_ID)
 * @returns USDC balance in min denom, or '0' if not found
 */
export async function queryShieldedUSDCBalance(
  viewingKey: string,
  chainId: string = NAMADA_CHAIN_ID,
): Promise<string> {
  try {
    const usdcAddress = await getUSDCAddressFromRegistry()
    if (!usdcAddress) {
      console.warn('[ShieldedBalanceHelpers] USDC token address not configured')
      return '0'
    }

    const balances = await queryShieldedBalances(viewingKey, [usdcAddress], chainId)
    const match = balances.find(([addr]) => addr === usdcAddress)
    return match ? match[1] : '0'
  } catch (error) {
    console.error('[ShieldedBalanceHelpers] Failed to query shielded USDC balance:', error)
    return '0'
  }
}

/**
 * Query and format shielded USDC balance for display.
 * @param viewingKey - The viewing key to query
 * @param chainId - The chain ID (defaults to NAMADA_CHAIN_ID)
 * @returns Formatted USDC balance string (e.g., "123.456789")
 */
export async function getFormattedShieldedUSDCBalance(
  viewingKey: string,
  chainId: string = NAMADA_CHAIN_ID,
): Promise<string> {
  const balanceMinDenom = await queryShieldedUSDCBalance(viewingKey, chainId)
  return formatMinDenom(balanceMinDenom, 6)
}

