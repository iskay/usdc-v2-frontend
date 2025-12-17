import { useState, useEffect } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { preferredChainKeyAtom } from '@/atoms/appAtom'
import { fetchEvmChainsConfig } from '@/services/config/chainConfigService'
import { findChainByChainId, getDefaultChainKey } from '@/config/chains'
import { useWallet } from '@/hooks/useWallet'

export interface UseDepositChainReturn {
  selectedChain: string | undefined
  chainName: string
  setSelectedChain: (chain: string | undefined) => void
}

/**
 * Hook to manage chain selection and loading for deposit flow
 * Handles chain loading from atom, MetaMask, or config defaults
 */
export function useDepositChain(): UseDepositChainReturn {
  const { state: walletState } = useWallet()
  const preferredChainKey = useAtomValue(preferredChainKeyAtom)
  const setPreferredChainKey = useSetAtom(preferredChainKeyAtom)
  const [selectedChain, setSelectedChain] = useState<string | undefined>(undefined)
  const [chainName, setChainName] = useState('')

  // Load chain: prefer preferredChainKeyAtom, then MetaMask chainId, then default from config
  useEffect(() => {
    let mounted = true

    async function loadChain() {
      try {
        // Precedence order: atom -> metamask value -> default
        let chainKey: string | undefined

        // 1. First check if preferredChainKeyAtom has a value
        if (preferredChainKey) {
          chainKey = preferredChainKey
        } else {
          // 2. Try to derive from MetaMask chainId
          const config = await fetchEvmChainsConfig()
          if (walletState.metaMask.isConnected && walletState.metaMask.chainId && config) {
            const chain = findChainByChainId(config, walletState.metaMask.chainId)
            if (chain) {
              chainKey = chain.key
              // Set preferredChainKeyAtom when deriving from MetaMask
              if (mounted) {
                setPreferredChainKey(chainKey)
              }
            }
          }

          // 3. Fall back to default chain from config
          if (!chainKey && config) {
            chainKey = getDefaultChainKey(config)
          }
        }

        // Set selectedChain if we have a chainKey
        if (mounted && chainKey) {
          setSelectedChain(chainKey)
        }
      } catch (error) {
        console.error('[useDepositChain] Failed to load chain:', error)
      }
    }

    void loadChain()

    return () => {
      mounted = false
    }
  }, [preferredChainKey, walletState.metaMask.isConnected, walletState.metaMask.chainId, setPreferredChainKey])

  // Get chain name for display
  useEffect(() => {
    let mounted = true

    async function loadChainName() {
      try {
        const config = await fetchEvmChainsConfig()
        if (mounted) {
          const chain = config.chains.find((c) => c.key === selectedChain)
          setChainName(chain?.name ?? selectedChain ?? '')
        }
      } catch (error) {
        console.error('[useDepositChain] Failed to load chain name:', error)
        if (mounted) {
          setChainName(selectedChain ?? '')
        }
      }
    }

    if (selectedChain) {
      void loadChainName()
    }

    return () => {
      mounted = false
    }
  }, [selectedChain])

  // Set preferred chain key when selectedChain changes (for polling to use)
  useEffect(() => {
    if (selectedChain) {
      setPreferredChainKey(selectedChain)
    }
  }, [selectedChain, setPreferredChainKey])

  return {
    selectedChain,
    chainName,
    setSelectedChain,
  }
}

