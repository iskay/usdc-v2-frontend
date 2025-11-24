import { ethers } from 'ethers'
import { jotaiStore } from '@/store/jotaiStore'
import { chainConfigAtom } from '@/atoms/appAtom'
import { findChainByKey } from '@/config/chains'

/**
 * Get USDC contract address for a given chain key from chain config.
 * @param chainKey - The chain key (e.g., 'sepolia', 'base-sepolia')
 * @returns USDC contract address, or undefined if chain not found or config not loaded
 */
export function getUsdcContractAddress(chainKey: string): string | undefined {
  const chainConfig = jotaiStore.get(chainConfigAtom)
  // if (!chainConfig) {
  //   console.warn('[EvmBalanceService] Chain config not loaded yet', { chainKey })
  //   return undefined
  // }

  const chain = findChainByKey(chainConfig, chainKey)
  if (!chain) {
    console.warn('[EvmBalanceService] Chain not found in config', { chainKey })
    return undefined
  }

  return chain.contracts.usdc
}

/**
 * Get primary RPC URL for a given chain key from chain config.
 * @param chainKey - The chain key (e.g., 'sepolia', 'base-sepolia')
 * @returns Primary RPC URL, or undefined if chain not found or config not loaded
 */
export function getPrimaryRpcUrl(chainKey: string): string | undefined {
  const chainConfig = jotaiStore.get(chainConfigAtom)
  if (!chainConfig) {
    console.warn('[EvmBalanceService] Chain config not loaded yet', { chainKey })
    return undefined
  }

  const chain = findChainByKey(chainConfig, chainKey)
  if (!chain) {
    console.warn('[EvmBalanceService] Chain not found in config', { chainKey })
    return undefined
  }

  return chain.rpcUrls[0]
}

/**
 * Fetch USDC balance for a given EVM address on a specific chain.
 * @param chainKey - The chain key (e.g., 'sepolia', 'base-sepolia')
 * @param address - The EVM address to query
 * @returns Formatted USDC balance as string (6 decimals), or '--' if fetch fails
 */
export async function fetchEvmUsdcBalance(
  chainKey: string,
  address: string
): Promise<string> {
  try {
    // Validate address format
    if (!address || !address.startsWith('0x') || address.length !== 42) {
      console.warn('[EvmBalanceService] Invalid address format', { chainKey, address })
      return '--'
    }

    // Get chain configuration
    const usdcAddress = getUsdcContractAddress(chainKey)
    const rpcUrl = getPrimaryRpcUrl(chainKey)

    if (!usdcAddress || !rpcUrl) {
      console.warn('[EvmBalanceService] Missing chain configuration', {
        chainKey,
        hasUsdcAddress: !!usdcAddress,
        hasRpcUrl: !!rpcUrl,
      })
      return '--'
    }

    // Create provider and contract
    const provider = new ethers.JsonRpcProvider(rpcUrl)
    const contract = new ethers.Contract(
      usdcAddress,
      ['function balanceOf(address) view returns (uint256)'],
      provider
    )

    // Fetch balance
    const balance = await contract.balanceOf(address)

    // Format balance to 6 decimals (USDC has 6 decimals)
    const formatted = ethers.formatUnits(balance, 6)
    // Use toFixed(6) to ensure consistent formatting
    const formattedBalance = Number.parseFloat(formatted).toFixed(6)

    return formattedBalance
  } catch (error) {
    console.error('[EvmBalanceService] Failed to fetch USDC balance', {
      chainKey,
      address: address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'undefined',
      error: error instanceof Error ? error.message : String(error),
    })
    return '--'
  }
}

