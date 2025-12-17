import { useState } from 'react'
import { useSetAtom } from 'jotai'
import { useToast } from '@/hooks/useToast'
import { useWallet } from '@/hooks/useWallet'
import { depositFallbackSelectionAtom } from '@/atoms/appAtom'
import { deriveNobleFallbackFromMetaMask, saveDerivedFallbackToStorage } from '@/services/fallback/nobleFallbackDerivationService'

export interface DerivationState {
  isLoading: boolean
  stage: 'idle' | 'signing' | 'extracting' | 'deriving' | 'success' | 'error'
  error: string | null
}

export interface UseNobleFallbackDerivationReturn {
  derivationState: DerivationState
  deriveFallback: () => Promise<boolean>
}

/**
 * Hook to manage Noble fallback address derivation from MetaMask
 */
export function useNobleFallbackDerivation(): UseNobleFallbackDerivationReturn {
  const { state: walletState } = useWallet()
  const { notify } = useToast()
  const setDepositFallbackSelection = useSetAtom(depositFallbackSelectionAtom)

  const [derivationState, setDerivationState] = useState<DerivationState>({
    isLoading: false,
    stage: 'idle',
    error: null,
  })

  const deriveFallback = async (): Promise<boolean> => {
    if (!walletState.metaMask.isConnected || !walletState.metaMask.account) {
      notify({
        title: 'MetaMask Not Connected',
        description: 'Please connect your MetaMask wallet to derive a fallback address.',
        level: 'error',
      })
      return false
    }

    setDerivationState({
      isLoading: true,
      stage: 'signing',
      error: null,
    })

    try {
      // Stage 1: Request signature
      notify({
        title: 'Requesting Signature',
        description: 'Please sign the message in MetaMask to derive your Noble fallback address.',
        level: 'info',
      })

      setDerivationState({
        isLoading: true,
        stage: 'extracting',
        error: null,
      })

      setDerivationState({
        isLoading: true,
        stage: 'deriving',
        error: null,
      })

      const result = await deriveNobleFallbackFromMetaMask({
        evmAddress: walletState.metaMask.account,
      })

      // Save to derived storage (keyed by EVM address)
      await saveDerivedFallbackToStorage(result)

      // Update selection atom to use derived address
      setDepositFallbackSelection({
        source: 'derived',
        address: result.nobleAddress,
      })

      setDerivationState({
        isLoading: false,
        stage: 'success',
        error: null,
      })

      notify({
        title: 'Address Derived Successfully',
        description: `Noble fallback address: ${result.nobleAddress.slice(0, 16)}...`,
        level: 'success',
      })

      return true
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to derive Noble fallback address'

      setDerivationState({
        isLoading: false,
        stage: 'error',
        error: errorMessage,
      })

      notify({
        title: 'Derivation Failed',
        description: errorMessage,
        level: 'error',
      })

      return false
    }
  }

  return {
    derivationState,
    deriveFallback,
  }
}

