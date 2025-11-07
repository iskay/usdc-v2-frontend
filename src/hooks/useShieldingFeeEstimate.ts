/**
 * Hook for estimating shielding fees for display purposes.
 */

import { useState, useEffect } from 'react'
import { logger } from '@/utils/logger'
import { estimateShieldingFeeForDisplay, type ShieldingFeeInfo } from '@/services/shielded/shieldingService'

export interface UseShieldingFeeEstimateState {
  feeInfo: ShieldingFeeInfo | null
  isLoading: boolean
  error: string | null
}

export interface UseShieldingFeeEstimateReturn {
  state: UseShieldingFeeEstimateState
}

/**
 * Hook for estimating shielding fees when amount changes.
 * This uses the same logic as prepareShieldingParams to ensure consistency.
 *
 * @param amount - The amount in display units (e.g., "10.5" for 10.5 USDC)
 * @param transparentAddress - The transparent address
 * @returns Fee estimation state
 */
export function useShieldingFeeEstimate(
  amount: string,
  transparentAddress: string | undefined,
): UseShieldingFeeEstimateReturn {
  const [state, setState] = useState<UseShieldingFeeEstimateState>({
    feeInfo: null,
    isLoading: false,
    error: null,
  })

  useEffect(() => {
    // Reset state if amount is invalid or address is missing
    if (!amount || parseFloat(amount) <= 0 || !transparentAddress) {
      setState({
        feeInfo: null,
        isLoading: false,
        error: null,
      })
      return
    }

    const estimateFee = async () => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }))

      try {
        logger.debug('[useShieldingFeeEstimate] Estimating fee', {
          amount,
          transparent: transparentAddress.slice(0, 12) + '...',
        })

        const feeInfo = await estimateShieldingFeeForDisplay(transparentAddress, amount)

        logger.debug('[useShieldingFeeEstimate] Fee estimated successfully', {
          feeAmount: feeInfo.feeAmount,
          feeToken: feeInfo.feeToken,
          finalAmount: feeInfo.finalAmount,
        })

        setState({
          feeInfo,
          isLoading: false,
          error: null,
        })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to estimate fee'
        logger.warn('[useShieldingFeeEstimate] Fee estimation failed', {
          error: errorMessage,
          amount,
          transparent: transparentAddress.slice(0, 12) + '...',
        })

        setState({
          feeInfo: null,
          isLoading: false,
          error: errorMessage,
        })
      }
    }

    void estimateFee()
  }, [amount, transparentAddress])

  return { state }
}

