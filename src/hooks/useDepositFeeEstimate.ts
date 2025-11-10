/**
 * Hook for estimating deposit fees for display purposes.
 */

import { useState, useEffect } from 'react'
import { logger } from '@/utils/logger'
import {
  estimateDepositFeeForDisplay,
  type DepositFeeInfo,
} from '@/services/deposit/evmFeeEstimatorService'
import { checkNobleForwardingRegistration } from '@/services/deposit/nobleForwardingService'

export interface UseDepositFeeEstimateState {
  feeInfo: DepositFeeInfo | null
  isLoading: boolean
  error: string | null
}

export interface UseDepositFeeEstimateReturn {
  state: UseDepositFeeEstimateState
}

/**
 * Hook for estimating deposit fees when chain, amount, or addresses change.
 * This checks Noble forwarding registration and estimates EVM gas fees.
 *
 * @param chainKey - The EVM chain key
 * @param amount - The deposit amount (optional)
 * @param namadaAddress - The Namada destination address
 * @param evmAddress - The EVM address (for gas estimation)
 * @returns Fee estimation state
 */
export function useDepositFeeEstimate(
  chainKey: string | undefined,
  amount: string | undefined,
  namadaAddress: string | undefined,
  evmAddress: string | undefined,
): UseDepositFeeEstimateReturn {
  const [state, setState] = useState<UseDepositFeeEstimateState>({
    feeInfo: null,
    isLoading: false,
    error: null,
  })

  useEffect(() => {
    // Reset state if required dependencies are missing
    if (!chainKey || !evmAddress) {
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
        logger.debug('[useDepositFeeEstimate] Estimating fee', {
          chainKey,
          amount,
          namadaAddress: namadaAddress ? namadaAddress.slice(0, 12) + '...' : undefined,
          evmAddress: evmAddress.slice(0, 10) + '...',
        })

        // Check Noble forwarding registration status first
        let nobleRegistered = false
        if (namadaAddress) {
          try {
            const registrationStatus = await checkNobleForwardingRegistration(namadaAddress)
            nobleRegistered = registrationStatus.exists
            logger.debug('[useDepositFeeEstimate] Noble registration status', {
              namadaAddress: namadaAddress.slice(0, 12) + '...',
              exists: nobleRegistered,
            })
          } catch (error) {
            logger.warn('[useDepositFeeEstimate] Noble registration check failed, assuming not registered', {
              error: error instanceof Error ? error.message : String(error),
            })
            // Assume not registered on error (include fee)
            nobleRegistered = false
          }
        }

        // Estimate EVM fees
        const feeInfo = await estimateDepositFeeForDisplay(chainKey, amount, evmAddress)

        // Subtract Noble registration fee if already registered
        // Note: Noble registration fee is in USD, but we calculate total in native token
        // For Phase 1, we'll show native token amounts separately from Noble fee
        const finalFeeInfo: DepositFeeInfo = {
          ...feeInfo,
          nobleRegUsd: nobleRegistered ? 0 : feeInfo.nobleRegUsd,
          // Total native token amount doesn't include Noble fee (it's in USD)
          // We'll handle the display in the UI
        }

        logger.debug('[useDepositFeeEstimate] Fee estimated successfully', {
          approveNative: finalFeeInfo.approveNative,
          burnNative: finalFeeInfo.burnNative,
          totalNative: finalFeeInfo.totalNative,
          nativeSymbol: finalFeeInfo.nativeSymbol,
          nobleRegUsd: finalFeeInfo.nobleRegUsd,
          nobleRegistered,
        })

        setState({
          feeInfo: finalFeeInfo,
          isLoading: false,
          error: null,
        })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to estimate fee'
        logger.warn('[useDepositFeeEstimate] Fee estimation failed', {
          error: errorMessage,
          chainKey,
          amount,
          namadaAddress: namadaAddress ? namadaAddress.slice(0, 12) + '...' : undefined,
          evmAddress: evmAddress.slice(0, 10) + '...',
        })

        setState({
          feeInfo: null,
          isLoading: false,
          error: errorMessage,
        })
      }
    }

    void estimateFee()
  }, [chainKey, amount, namadaAddress, evmAddress])

  return { state }
}

