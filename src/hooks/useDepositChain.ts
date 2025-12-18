import { useChainSelection } from '@/hooks/useChainSelection'

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
  return useChainSelection({
    strategy: 'preferred',
    updatePreferred: true,
    useMetaMaskFallback: true,
  })
}

