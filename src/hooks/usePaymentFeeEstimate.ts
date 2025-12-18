/**
 * Hook for estimating payment fees for display purposes.
 */

import { useFeeEstimate } from '@/hooks/useFeeEstimate'
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
  const state = useFeeEstimate<PaymentFeeInfo>({
    estimator: async () => {
      return await estimatePaymentFeeForDisplay(transparentAddress!, shieldedAddress, amount)
    },
    enabled: !!transparentAddress,
    validate: () => !!transparentAddress,
    logContext: 'payment',
    dependencies: [amount, transparentAddress, shieldedAddress],
  })

  return { state }
}

