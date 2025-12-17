import { useState, useEffect } from 'react'
import { fetchEvmChainsConfig } from '@/services/config/chainConfigService'

export interface UseSendPaymentChainReturn {
  selectedChain: string | undefined
  chainName: string
  setSelectedChain: (chain: string | undefined) => void
}

/**
 * Hook to manage chain selection and loading for send payment flow
 * Handles loading default chain from config and chain name for display
 */
export function useSendPaymentChain(): UseSendPaymentChainReturn {
  const [selectedChain, setSelectedChain] = useState<string | undefined>(undefined)
  const [chainName, setChainName] = useState('')

  // Load default chain from config
  useEffect(() => {
    let mounted = true

    async function loadDefaultChain() {
      try {
        const config = await fetchEvmChainsConfig()
        if (mounted && config.defaults?.selectedChainKey) {
          setSelectedChain(config.defaults.selectedChainKey)
        }
      } catch (error) {
        console.error('[useSendPaymentChain] Failed to load default chain:', error)
      }
    }

    void loadDefaultChain()

    return () => {
      mounted = false
    }
  }, [])

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
        console.error('[useSendPaymentChain] Failed to load chain name:', error)
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

  return {
    selectedChain,
    chainName,
    setSelectedChain,
  }
}

