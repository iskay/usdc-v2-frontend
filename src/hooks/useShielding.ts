/**
 * Hook for shielding transactions.
 */

import { useCallback } from 'react'
import { useAtomValue, useAtom } from 'jotai'
import { walletAtom } from '@/atoms/walletAtom'
import { txUiAtom, resetTxUiState } from '@/atoms/txUiAtom'
import { useToast } from '@/hooks/useToast'
import { executeShielding, type ShieldingPhase, type ShieldingResult } from '@/services/shielded/shieldingOrchestrator'
import { logger } from '@/utils/logger'
import { getUSDCAddressFromRegistry } from '@/services/namada/namadaBalanceService'
import BigNumber from 'bignumber.js'
import { buildShieldingToast } from '@/utils/toastHelpers'
import type { TransactionPhase } from '@/components/tx/ProgressStepper'

export interface UseShieldingState {
  isShielding: boolean
  phase?: ShieldingPhase
  error?: string
}

export interface UseShieldingReturn {
  state: UseShieldingState
  shield: (amount: string) => Promise<ShieldingResult | null>
  reset: () => void
}

/**
 * Maps ShieldingPhase to TransactionPhase for global state.
 */
function mapShieldingPhaseToTransactionPhase(phase: ShieldingPhase): TransactionPhase {
  if (phase === 'submitted') {
    return null // Success overlay handles completion
  }
  return phase as TransactionPhase
}

/**
 * Hook for executing shielding transactions.
 */
export function useShielding(): UseShieldingReturn {
  const walletState = useAtomValue(walletAtom)
  const { notify, updateToast, dismissToast } = useToast()
  const [txUiState, setTxUiState] = useAtom(txUiAtom)

  // Derive UseShieldingState from global state for backward compatibility
  const state: UseShieldingState = {
    isShielding: txUiState.isSubmitting || txUiState.phase !== null,
    phase: txUiState.phase ? (txUiState.phase as ShieldingPhase) : undefined,
    error: txUiState.errorState?.message,
  }

  const reset = useCallback(() => {
    resetTxUiState(setTxUiState)
  }, [setTxUiState])

  const shield = useCallback(
    async (amount: string): Promise<ShieldingResult | null> => {
      // Validate wallet connection
      if (!walletState.namada.isConnected) {
        const error = 'Namada Keychain not connected'
        notify({
          title: 'Shield',
          description: error,
          level: 'error',
        })
        setTxUiState({ ...txUiState, isSubmitting: false, errorState: { message: error }, transactionType: null })
        return null
      }

      const transparent = walletState.namada.account
      let shielded = walletState.namada.shieldedAccount

      // If shielded address is missing, try to fetch it from extension
      if (!shielded && transparent) {
        logger.debug('[useShielding] Shielded address missing, fetching from extension', {
          transparent: transparent.slice(0, 12) + '...',
        })
        try {
          const { getShieldedPaymentAddressFromExtension } = await import(
            '@/services/shielded/shieldingService'
          )
          shielded = (await getShieldedPaymentAddressFromExtension(transparent)) ?? undefined
          if (shielded) {
            logger.debug('[useShielding] Shielded payment address fetched from extension', {
              transparent: transparent.slice(0, 12) + '...',
              shielded: shielded.slice(0, 12) + '...',
            })
          }
        } catch (error) {
          logger.warn('[useShielding] Failed to fetch shielded address from extension', {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      if (!transparent || !shielded) {
        const error = 'Missing Namada addresses. Please ensure both transparent and shielded addresses are available. Try reconnecting your wallet.'
        logger.error('[useShielding] Missing addresses', {
          hasTransparent: !!transparent,
          hasShielded: !!shielded,
          transparent: transparent ? transparent.slice(0, 12) + '...' : 'N/A',
        })
        notify({
          title: 'Shield',
          description: error,
          level: 'error',
        })
        setTxUiState({ ...txUiState, isSubmitting: false, errorState: { message: error }, transactionType: null })
        return null
      }

      // Validate amount
      if (!amount || amount === '0' || amount === '0.0' || amount === '0.00') {
        const error = 'Amount must be greater than zero'
        notify({
          title: 'Shield',
          description: error,
          level: 'error',
        })
        setTxUiState({ ...txUiState, isSubmitting: false, errorState: { message: error }, transactionType: null })
        return null
      }

      // Convert amount to base units (both USDC and NAM use 6 decimals, divide by 1000000)
      let amountInBase: string
      try {
        const amountBN = new BigNumber(amount)
        if (amountBN.isLessThanOrEqualTo(0)) {
          throw new Error('Amount must be greater than zero')
        }
        // Both USDC and NAM use 6 decimals: multiply by 10^6 to convert to min denom
        amountInBase = amountBN.multipliedBy(new BigNumber(10).pow(6)).toString()
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Invalid amount format'
        notify({
          title: 'Shield',
          description: errorMessage,
          level: 'error',
        })
        setTxUiState({ ...txUiState, isSubmitting: false, errorState: { message: errorMessage }, transactionType: null })
        return null
      }

      // Get USDC token address
      const tokenAddress = await getUSDCAddressFromRegistry()
      if (!tokenAddress) {
        const error = 'USDC token address not found. Please configure VITE_USDC_TOKEN_ADDRESS'
        notify({
          title: 'Shield',
          description: error,
          level: 'error',
        })
        setTxUiState({ ...txUiState, isSubmitting: false, errorState: { message: error }, transactionType: null })
        return null
      }

      // Initialize global state for shield transaction
      setTxUiState({
        ...txUiState,
        isSubmitting: true,
        phase: 'building',
        errorState: null,
        txHash: null,
        explorerUrl: undefined,
        showSuccessState: false,
        transactionType: 'shield',
      })

      try {
        logger.info('[useShielding] Starting shielding flow', {
          transparent: transparent.slice(0, 12) + '...',
          shielded: shielded.slice(0, 12) + '...',
          amount,
          amountInBase,
        })

        // Execute shielding with phase callbacks
        const result = await executeShielding(
          {
            transparent,
            shielded,
            amountInBase,
            tokenAddress,
          },
          {
            onPhase: (phase) => {
              logger.debug('[useShielding] Phase update', { phase })
              // Map ShieldingPhase to TransactionPhase for global state
              const transactionPhase = mapShieldingPhaseToTransactionPhase(phase)
              setTxUiState((prev) => ({
                ...prev,
                phase: transactionPhase,
              }))

              // Show toast for each phase using consistent ID for updates
              const shieldingToastId = 'shielding-operation'
              switch (phase) {
                case 'building':
                  notify(buildShieldingToast('building'))
                  break
                case 'signing':
                  updateToast(shieldingToastId, buildShieldingToast('signing'))
                  break
                case 'submitting':
                  updateToast(shieldingToastId, buildShieldingToast('submitting'))
                  break
                case 'submitted':
                  // Success toast will be shown after result
                  break
              }
            },
            onProgress: (progress) => {
              logger.debug('[useShielding] Progress update', progress)
            },
          },
        )

        logger.info('[useShielding] Shielding completed successfully', {
          txHash: result.txHash.slice(0, 16) + '...',
        })

        // Show success toast with transaction hash
        updateToast('shielding-operation', buildShieldingToast('submitted', result.txHash))

        // Update global state with success (phase is null, success overlay handles completion)
        setTxUiState({
          ...txUiState,
          isSubmitting: false,
          phase: null,
          txHash: result.txHash,
          showSuccessState: true,
        })

        // Fetch explorer URL
        const { getNamadaTxExplorerUrl } = await import('@/utils/explorerUtils')
        getNamadaTxExplorerUrl(result.txHash).then((url) => {
          setTxUiState((prev) => ({ ...prev, explorerUrl: url }))
        }).catch(() => {
          // Silently fail if explorer URL can't be fetched
        })

        return result
      } catch (error) {
        // Dismiss the loading toast if it exists
        dismissToast('shielding-operation')
        
        const errorMessage = error instanceof Error ? error.message : 'Shield transaction failed'
        logger.error('[useShielding] Shielding failed', {
          error: errorMessage,
          errorStack: error instanceof Error ? error.stack : undefined,
        })

        notify({
          title: 'Shield',
          description: errorMessage,
          level: 'error',
        })

        // Update global state with error
        setTxUiState({
          ...txUiState,
          isSubmitting: false,
          phase: null,
          errorState: { message: errorMessage },
          transactionType: null,
        })

        return null
      }
    },
    [walletState.namada, notify, txUiState, setTxUiState],
  )

  return {
    state,
    shield,
    reset,
  }
}

