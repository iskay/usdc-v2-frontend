/**
 * Hook for estimating deposit fees for display purposes.
 */

import { useState, useEffect } from 'react'
import { useAtomValue } from 'jotai'
import { logger } from '@/utils/logger'
import {
  estimateDepositFeeForDisplay,
  type DepositFeeInfo,
} from '@/services/deposit/evmFeeEstimatorService'
import { checkNobleForwardingRegistration } from '@/services/deposit/nobleForwardingService'
import { depositFallbackSelectionAtom } from '@/atoms/appAtom'

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
  const depositFallbackSelection = useAtomValue(depositFallbackSelectionAtom)
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
            // Use fallback address from deposit selection, or empty string if not available
            // If fallback is unknown (needs to be derived), assume registration fee is needed
            const fallback = depositFallbackSelection.address || ''
            
            // If fallback address is not available, assume registration fee is needed
            if (!fallback) {
              logger.debug('[useDepositFeeEstimate] Fallback address not available, assuming registration fee needed', {
                namadaAddress: namadaAddress.slice(0, 12) + '...',
              })
              nobleRegistered = false
            } else {
              const registrationStatus = await checkNobleForwardingRegistration(namadaAddress, undefined, fallback)
              
              // If there's an error determining status, log it and assume not registered (include fee)
              if (registrationStatus.error) {
                logger.warn('[useDepositFeeEstimate] Could not determine Noble registration status, assuming not registered', {
                  namadaAddress: namadaAddress.slice(0, 12) + '...',
                  error: registrationStatus.error,
                })
                nobleRegistered = false
              } else {
                nobleRegistered = registrationStatus.exists
                logger.debug('[useDepositFeeEstimate] Noble registration status', {
                  namadaAddress: namadaAddress.slice(0, 12) + '...',
                  exists: nobleRegistered,
                })
              }
            }
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
  }, [chainKey, amount, namadaAddress, evmAddress, depositFallbackSelection])

  return { state }
}

