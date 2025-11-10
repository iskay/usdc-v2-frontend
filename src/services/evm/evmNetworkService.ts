/**
 * EVM network management service for handling network switching,
 * provider creation, and signer management.
 */

import { ethers } from 'ethers'
import { jotaiStore } from '@/store/jotaiStore'
import { chainConfigAtom } from '@/atoms/appAtom'
import { findChainByKey } from '@/config/chains'
import { logger } from '@/utils/logger'

/**
 * Get the expected chain ID for a given chain key.
 * @param chainKey - The chain key (e.g., 'sepolia', 'base-sepolia')
 * @returns The chain ID, or undefined if chain not found
 */
function getExpectedChainId(chainKey: string): number | undefined {
  const chainConfig = jotaiStore.get(chainConfigAtom)
  if (!chainConfig) {
    return undefined
  }

  const chain = findChainByKey(chainConfig, chainKey)
  return chain?.chainId
}

/**
 * Switch MetaMask to the specified network.
 * @param chainKey - The chain key to switch to
 * @throws Error if network switching fails
 */
async function switchToNetwork(chainKey: string): Promise<void> {
  if (!window.ethereum) {
    throw new Error('MetaMask not available')
  }

  const chainConfig = jotaiStore.get(chainConfigAtom)
  if (!chainConfig) {
    throw new Error('Chain configuration not loaded')
  }

  const chain = findChainByKey(chainConfig, chainKey)
  if (!chain) {
    throw new Error(`Chain not found: ${chainKey}`)
  }

  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chain.chainIdHex }],
    })
  } catch (error: unknown) {
    // If the chain is not added, try to add it
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === 4902 || error.code === -32603)
    ) {
      // Chain not added, try to add it
      try {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: chain.chainIdHex,
              chainName: chain.name,
              nativeCurrency: chain.nativeCurrency,
              rpcUrls: chain.rpcUrls,
              blockExplorerUrls: [chain.explorer.baseUrl],
            },
          ],
        })
      } catch (addError) {
        throw new Error(
          `Failed to add network ${chainKey}. Please add it manually in MetaMask.`
        )
      }
    } else {
      throw new Error(
        `Failed to switch to network ${chainKey}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
}

/**
 * Ensures MetaMask is on the correct network for the given chain key.
 * Switches network if needed.
 * @param chainKey - The chain key to ensure
 * @throws Error if network switching fails or MetaMask is not available
 */
export async function ensureCorrectNetwork(chainKey: string): Promise<void> {
  if (!window.ethereum) {
    throw new Error('MetaMask not available')
  }

  const expectedChainId = getExpectedChainId(chainKey)
  if (!expectedChainId) {
    throw new Error(`Chain configuration not found for: ${chainKey}`)
  }

  const browserProvider = new ethers.BrowserProvider(window.ethereum)
  const network = await browserProvider.getNetwork()
  const currentChainId = Number(network.chainId)

  logger.info('[EvmNetworkService] 🌐 Network check', {
    chainKey,
    currentChainId,
    expectedChainId,
    match: currentChainId === expectedChainId,
  })

  if (currentChainId !== expectedChainId) {
    logger.info('[EvmNetworkService] 🔄 Network mismatch, switching...', {
      chainKey,
      currentChainId,
      expectedChainId,
    })

    try {
      await switchToNetwork(chainKey)
      // Wait a bit for network change to propagate
      await new Promise((resolve) => setTimeout(resolve, 2000))

      // Verify the switch was successful
      const newBrowserProvider = new ethers.BrowserProvider(window.ethereum)
      const newNetwork = await newBrowserProvider.getNetwork()
      const newChainId = Number(newNetwork.chainId)

      if (newChainId !== expectedChainId) {
        throw new Error(
          `Failed to switch to ${chainKey} network. Please switch manually in MetaMask.`
        )
      }

      logger.info('[EvmNetworkService] ✅ Network switched successfully', {
        chainKey,
        chainId: newChainId,
        expectedChainId,
      })
    } catch (error) {
      // Check if it's a network change error (which is actually success)
      if (
        error instanceof Error &&
        error.message.includes('network changed')
      ) {
        console.debug('[EvmNetworkService] Network change detected, continuing...')
        return
      }
      throw error
    }
  }
}

/**
 * Gets an EVM signer from MetaMask.
 * @returns The ethers signer
 * @throws Error if MetaMask is not available
 */
export async function getEvmSigner(): Promise<ethers.Signer> {
  if (!window.ethereum) {
    throw new Error('MetaMask not available')
  }

  const provider = new ethers.BrowserProvider(window.ethereum)
  return await provider.getSigner()
}

/**
 * Gets an EVM provider for a given chain key.
 * Uses the RPC URL from chain config for read operations.
 * @param chainKey - The chain key
 * @returns The ethers JSON RPC provider
 * @throws Error if chain config is not available or RPC URL is missing
 */
export async function getEvmProvider(
  chainKey: string
): Promise<ethers.JsonRpcProvider> {
  const chainConfig = jotaiStore.get(chainConfigAtom)
  if (!chainConfig) {
    throw new Error('Chain configuration not loaded')
  }

  const chain = findChainByKey(chainConfig, chainKey)
  if (!chain || !chain.rpcUrls[0]) {
    throw new Error(`Chain RPC URL not found for: ${chainKey}`)
  }

  return new ethers.JsonRpcProvider(chain.rpcUrls[0])
}

