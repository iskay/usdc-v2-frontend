/**
 * Hook for estimating payment fees for display purposes.
 */

import { useState, useEffect } from 'react'
import { logger } from '@/utils/logger'
import {
  estimatePaymentFeeForDisplay,
  type PaymentFeeInfo,
} from '@/services/payment/feeEstimatorService'

export interface UsePaymentFeeEstimateState {
  feeInfo: PaymentFeeInfo | null
  isLoading: boolean
  error: string | null
}

export interface UsePaymentFeeEstimateReturn {
  state: UsePaymentFeeEstimateState
}

/**
 * Hook for estimating payment fees when amount or addresses change.
 * This uses the same logic as payment transaction building to ensure consistency.
 *
 * @param amount - The amount in display units (optional, for future use)
 * @param transparentAddress - The transparent address
 * @param shieldedAddress - The shielded address (optional)
 * @returns Fee estimation state
 */
export function usePaymentFeeEstimate(
  amount: string | undefined,
  transparentAddress: string | undefined,
  shieldedAddress?: string | undefined,
): UsePaymentFeeEstimateReturn {
  const [state, setState] = useState<UsePaymentFeeEstimateState>({
    feeInfo: null,
    isLoading: false,
    error: null,
  })

  useEffect(() => {
    // Reset state if address is missing
    if (!transparentAddress) {
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
        logger.debug('[usePaymentFeeEstimate] Estimating fee', {
          amount,
          transparent: transparentAddress.slice(0, 12) + '...',
          shielded: shieldedAddress ? shieldedAddress.slice(0, 12) + '...' : undefined,
        })

        const feeInfo = await estimatePaymentFeeForDisplay(
          transparentAddress,
          shieldedAddress,
          amount,
        )

        logger.debug('[usePaymentFeeEstimate] Fee estimated successfully', {
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
        logger.warn('[usePaymentFeeEstimate] Fee estimation failed', {
          error: errorMessage,
          amount,
          transparent: transparentAddress.slice(0, 12) + '...',
          shielded: shieldedAddress ? shieldedAddress.slice(0, 12) + '...' : undefined,
        })

        setState({
          feeInfo: null,
          isLoading: false,
          error: errorMessage,
        })
      }
    }

    void estimateFee()
  }, [amount, transparentAddress, shieldedAddress])

  return { state }
}

