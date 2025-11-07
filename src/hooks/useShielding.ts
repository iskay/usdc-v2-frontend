/**
 * Hook for shielding transactions.
 */

import { useState, useCallback } from 'react'
import { useAtomValue } from 'jotai'
import { walletAtom } from '@/atoms/walletAtom'
import { useToast } from '@/hooks/useToast'
import { executeShielding, type ShieldingPhase, type ShieldingResult } from '@/services/shielded/shieldingOrchestrator'
import { logger } from '@/utils/logger'
import { env } from '@/config/env'
import { getUSDCAddressFromRegistry } from '@/services/namada/namadaBalanceService'
import BigNumber from 'bignumber.js'

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
 * Hook for executing shielding transactions.
 */
export function useShielding(): UseShieldingReturn {
  const walletState = useAtomValue(walletAtom)
  const { notify } = useToast()
  const [state, setState] = useState<UseShieldingState>({
    isShielding: false,
  })

  const reset = useCallback(() => {
    setState({
      isShielding: false,
    })
  }, [])

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
        setState({ isShielding: false, error })
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
          shielded = await getShieldedPaymentAddressFromExtension(transparent)
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
        setState({ isShielding: false, error })
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
        setState({ isShielding: false, error })
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
        setState({ isShielding: false, error: errorMessage })
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
        setState({ isShielding: false, error })
        return null
      }

      setState({
        isShielding: true,
        phase: 'building',
        error: undefined,
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
              setState((prev) => ({
                ...prev,
                phase,
              }))

              // Show toast for each phase
              switch (phase) {
                case 'building':
                  notify({
                    title: 'Shield',
                    description: 'Building shielding transaction...',
                    level: 'info',
                  })
                  break
                case 'signing':
                  notify({
                    title: 'Shield',
                    description: 'Waiting for approval...',
                    level: 'info',
                  })
                  break
                case 'submitting':
                  notify({
                    title: 'Shield',
                    description: 'Submitting transaction...',
                    level: 'info',
                  })
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

        // Show success toast
        const txHashDisplay = `${result.txHash.slice(0, 8)}...${result.txHash.slice(-8)}`
        notify({
          title: 'Shield',
          description: `Transaction submitted: ${txHashDisplay}`,
          level: 'success',
        })

        setState({
          isShielding: false,
          phase: 'submitted',
        })

        return result
      } catch (error) {
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

        setState({
          isShielding: false,
          error: errorMessage,
        })

        return null
      }
    },
    [walletState.namada, notify],
  )

  return {
    state,
    shield,
    reset,
  }
}

