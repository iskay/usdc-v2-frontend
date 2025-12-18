/**
 * Hook for estimating shielding fees for display purposes.
 */

import { useFeeEstimate } from '@/hooks/useFeeEstimate'
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
  const state = useFeeEstimate<ShieldingFeeInfo>({
    estimator: async () => {
      return await estimateShieldingFeeForDisplay(transparentAddress!, amount)
    },
    enabled: !!(amount && parseFloat(amount) > 0 && transparentAddress),
    validate: () => !!(amount && parseFloat(amount) > 0 && transparentAddress),
    logContext: 'shielding',
    dependencies: [amount, transparentAddress],
  })

  return { state }
}

