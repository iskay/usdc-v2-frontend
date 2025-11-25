/**
 * Noble Forwarding Registration Hook
 * 
 * Provides functionality to trigger Noble forwarding address registration
 * during deposit flows. Integrates with polling state to track registration status.
 */

import { useState, useCallback } from 'react'
import type { StoredTransaction } from '@/services/tx/transactionStorageService'
import {
  registerNobleForwarding,
  isNobleForwardingRegistered,
  type NobleForwardingRegistrationParams,
} from '@/services/polling/nobleForwardingRegistration'
import { useToast } from '@/hooks/useToast'
import { logger } from '@/utils/logger'
import { DEPOSIT_STAGES } from '@/shared/flowStages'

export interface UseNobleForwardingRegistrationReturn {
  /** Whether registration is in progress */
  isRegistering: boolean
  /** Whether registration is already completed */
  isRegistered: boolean
  /** Trigger registration */
  triggerRegistration: () => Promise<void>
  /** Check registration status */
  checkRegistrationStatus: () => Promise<boolean>
}

/**
 * Hook for Noble forwarding registration
 * 
 * @param transaction - Transaction to register forwarding for
 * @returns Registration controls and status
 */
export function useNobleForwardingRegistration(
  transaction: StoredTransaction,
): UseNobleForwardingRegistrationReturn {
  const [isRegistering, setIsRegistering] = useState(false)
  const { notify } = useToast()

  // Check if registration stage is already completed
  const isRegistered = Boolean(
    transaction.pollingState?.chainStatus.noble?.completedStages?.includes(
      DEPOSIT_STAGES.NOBLE_FORWARDING_REGISTRATION,
    ),
  )

  /**
   * Check if forwarding address is already registered
   */
  const checkRegistrationStatus = useCallback(async (): Promise<boolean> => {
    if (!transaction.pollingState) {
      return false
    }

    // Get forwarding address from transaction metadata
    const forwardingAddress =
      transaction.depositDetails?.nobleForwardingAddress ||
      transaction.pollingState.chainParams.noble?.metadata?.forwardingAddress

    if (!forwardingAddress) {
      logger.warn('[useNobleForwardingRegistration] No forwarding address found', {
        txId: transaction.id,
      })
      return false
    }

    try {
      const registered = await isNobleForwardingRegistered(forwardingAddress)
      return registered
    } catch (error) {
      logger.error('[useNobleForwardingRegistration] Failed to check registration status', {
        txId: transaction.id,
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }, [transaction])

  /**
   * Trigger Noble forwarding registration
   */
  const triggerRegistration = useCallback(async () => {
    if (!transaction.pollingState) {
      notify({
        title: 'Cannot Register',
        description: 'Transaction polling state not found.',
        level: 'error',
      })
      return
    }

    if (isRegistered) {
      notify({
        title: 'Already Registered',
        description: 'Noble forwarding address is already registered.',
        level: 'info',
      })
      return
    }

    setIsRegistering(true)

    try {
      // Get required parameters from transaction
      const forwardingAddress =
        transaction.depositDetails?.nobleForwardingAddress ||
        transaction.pollingState.chainParams.noble?.metadata?.forwardingAddress

      const recipientAddress =
        transaction.depositDetails?.destinationAddress ||
        transaction.pollingState.chainParams.noble?.metadata?.recipient

      if (!forwardingAddress || !recipientAddress) {
        throw new Error('Missing required parameters for registration')
      }

      const params: NobleForwardingRegistrationParams = {
        txId: transaction.id,
        forwardingAddress,
        recipientAddress,
        channelId: transaction.pollingState.chainParams.noble?.metadata?.channelId as string | undefined,
      }

      const result = await registerNobleForwarding(params)

      if (result.success) {
        notify({
          title: 'Registration Initiated',
          description: 'Noble forwarding registration has been initiated.',
          level: 'success',
        })
      } else {
        throw new Error(result.error || 'Registration failed')
      }
    } catch (error) {
      logger.error('[useNobleForwardingRegistration] Registration failed', {
        txId: transaction.id,
        error: error instanceof Error ? error.message : String(error),
      })

      notify({
        title: 'Registration Failed',
        description: error instanceof Error ? error.message : 'Failed to register Noble forwarding address.',
        level: 'error',
      })
    } finally {
      setIsRegistering(false)
    }
  }, [transaction, isRegistered, notify])

  return {
    isRegistering,
    isRegistered,
    triggerRegistration,
    checkRegistrationStatus,
  }
}

