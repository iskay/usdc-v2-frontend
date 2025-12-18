import { useChainSelection } from '@/hooks/useChainSelection'

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
  return useChainSelection({
    strategy: 'default',
    updatePreferred: false,
  })
}

