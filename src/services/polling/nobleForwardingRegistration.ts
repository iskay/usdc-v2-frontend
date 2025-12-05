/**
 * Noble Forwarding Registration Service
 * 
 * Handles Noble forwarding address registration for deposit flows.
 * Provides a registration job that can be triggered automatically or manually.
 */

import { logger } from '@/utils/logger'
import { transactionStorageService } from '@/services/tx/transactionStorageService'
import { updateChainStatus } from './pollingStateManager'
import { env } from '@/config/env'
import { createNobleLcdClient, getNobleUusdcBalance } from '@/services/noble/nobleLcdClient'
import { buildRegistrationTransaction } from '@/services/noble/nobleRegistrationTxBuilder'
import { checkNobleForwardingRegistration } from '@/services/deposit/nobleForwardingService'

/**
 * Registration job parameters
 */
export interface NobleForwardingRegistrationJobParams {
  /** Transaction ID (if part of a flow) */
  txId?: string
  /** Noble forwarding address */
  forwardingAddress: string
  /** Namada recipient address */
  recipientAddress: string
  /** IBC channel ID */
  channelId?: string
  /** Fallback address (optional) */
  fallback?: string
  /** Minimum balance threshold in uusdc (default from config) */
  minBalanceUusdc?: bigint
  /** Gas limit for registration tx (default from config) */
  gasLimit?: number
  /** Fee amount in uusdc (default from config) */
  feeUusdc?: string
  /** Optional abort signal for cancellation */
  abortSignal?: AbortSignal
}

/**
 * Registration job result with detailed metadata
 */
export interface NobleForwardingRegistrationJobResult {
  success: boolean
  /** Whether registration was needed */
  registrationNeeded: boolean
  /** Whether registration was already complete */
  alreadyRegistered: boolean
  /** Balance check result */
  balanceCheck: {
    performed: boolean
    sufficient: boolean
    balanceUusdc?: bigint
    minRequiredUusdc?: bigint
    error?: string
  }
  /** Registration transaction result */
  registrationTx: {
    attempted: boolean
    txHash?: string
    error?: string
  }
  /** Metadata for storage */
  metadata: {
    checkedAt: string
    registeredAt?: string
    registrationTxHash?: string
    errorMessage?: string
  }
}

/**
 * Legacy registration parameters (for backward compatibility)
 */
export interface NobleForwardingRegistrationParams {
  /** Transaction ID */
  txId: string
  /** Noble forwarding address */
  forwardingAddress: string
  /** Namada recipient address */
  recipientAddress: string
  /** IBC channel ID */
  channelId?: string
}

/**
 * Legacy registration result (for backward compatibility)
 */
export interface NobleForwardingRegistrationResult {
  success: boolean
  txHash?: string
  error?: string
}

/**
 * Execute Noble forwarding registration job
 * 
 * This is the main registration function that:
 * 1. Checks if registration is needed
 * 2. Checks balance threshold
 * 3. Builds and broadcasts registration transaction if conditions are met
 * 4. Updates polling state with results
 * 
 * @param params - Registration job parameters
 * @returns Detailed registration job result
 */
export async function executeRegistrationJob(
  params: NobleForwardingRegistrationJobParams,
): Promise<NobleForwardingRegistrationJobResult> {
  const {
    txId,
    forwardingAddress,
    recipientAddress,
    channelId,
    fallback = '',
    minBalanceUusdc = env.nobleRegMinUusdc(),
    gasLimit = env.nobleRegGasLimit(),
    feeUusdc = env.nobleRegFeeUusdc(),
    abortSignal,
  } = params

  const channel = channelId || env.nobleToNamadaChannel()
  const checkedAt = new Date().toISOString()

  logger.info('[NobleForwardingRegistration] Starting registration job', {
    txId,
    forwardingAddress: forwardingAddress.slice(0, 16) + '...',
    recipientAddress: recipientAddress.slice(0, 16) + '...',
    channel,
    fallback,
  })

  const result: NobleForwardingRegistrationJobResult = {
    success: false,
    registrationNeeded: false,
    alreadyRegistered: false,
    balanceCheck: {
      performed: false,
      sufficient: false,
    },
    registrationTx: {
      attempted: false,
    },
    metadata: {
      checkedAt,
    },
  }

  try {
    // Step 1: Check if registration is needed
    logger.debug('[NobleForwardingRegistration] Checking if registration is needed', {
      recipientAddress,
      channel,
    })

    const registrationStatus = await checkNobleForwardingRegistration(recipientAddress, channel)

    // Log error if registration status could not be determined
    if (registrationStatus.error) {
      logger.warn('[NobleForwardingRegistration] Could not determine registration status', {
        recipientAddress: recipientAddress.slice(0, 16) + '...',
        error: registrationStatus.error,
      })
      // Continue with registration process since we can't determine if already registered
    }

    if (registrationStatus.exists) {
      logger.info('[NobleForwardingRegistration] Address already registered', {
        forwardingAddress: forwardingAddress.slice(0, 16) + '...',
        recipientAddress: recipientAddress.slice(0, 16) + '...',
      })
      result.success = true
      result.alreadyRegistered = true
      result.metadata.registeredAt = checkedAt
      
      // Update polling state if txId provided
      if (txId) {
        updateRegistrationMetadata(txId, result)
      }
      
      return result
    }

    result.registrationNeeded = true

    // Step 2: Check balance
    logger.debug('[NobleForwardingRegistration] Checking balance', {
      forwardingAddress: forwardingAddress.slice(0, 16) + '...',
      minRequired: minBalanceUusdc.toString(),
    })

    try {
      const balance = await getNobleUusdcBalance(forwardingAddress, abortSignal)
      result.balanceCheck.performed = true
      result.balanceCheck.balanceUusdc = balance
      result.balanceCheck.minRequiredUusdc = minBalanceUusdc

      logger.debug('[NobleForwardingRegistration] Balance check result', {
        forwardingAddress: forwardingAddress.slice(0, 16) + '...',
        balance: balance.toString(),
        minRequired: minBalanceUusdc.toString(),
        sufficient: balance >= minBalanceUusdc,
      })

      if (balance < minBalanceUusdc) {
        const errorMessage = `Insufficient balance: ${balance.toString()} uusdc < ${minBalanceUusdc.toString()} uusdc required`
        logger.warn('[NobleForwardingRegistration] Insufficient balance for registration', {
          forwardingAddress: forwardingAddress.slice(0, 16) + '...',
          balance: balance.toString(),
          minRequired: minBalanceUusdc.toString(),
        })
        result.balanceCheck.sufficient = false
        result.balanceCheck.error = errorMessage
        result.metadata.errorMessage = errorMessage
        
        // Update polling state if txId provided
        if (txId) {
          updateRegistrationMetadata(txId, result)
        }
        
        return result
      }

      result.balanceCheck.sufficient = true
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to check balance'
      logger.error('[NobleForwardingRegistration] Balance check failed', {
        forwardingAddress: forwardingAddress.slice(0, 16) + '...',
        error: errorMessage,
      })
      result.balanceCheck.performed = true
      result.balanceCheck.error = errorMessage
      result.metadata.errorMessage = errorMessage
      
      // Update polling state if txId provided
      if (txId) {
        updateRegistrationMetadata(txId, result)
      }
      
      return result
    }

    // Step 3: Build registration transaction
    logger.debug('[NobleForwardingRegistration] Building registration transaction', {
      forwardingAddress: forwardingAddress.slice(0, 16) + '...',
      recipientAddress: recipientAddress.slice(0, 16) + '...',
      channel,
      fallback,
      gasLimit,
      feeUusdc,
    })

    let txBytes: string
    try {
      const txResult = buildRegistrationTransaction({
        nobleAddress: forwardingAddress,
        recipient: recipientAddress,
        channel,
        fallback,
        gasLimit,
        feeAmount: feeUusdc,
      })
      txBytes = txResult.txBytes
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to build transaction'
      logger.error('[NobleForwardingRegistration] Transaction build failed', {
        forwardingAddress: forwardingAddress.slice(0, 16) + '...',
        error: errorMessage,
      })
      result.registrationTx.attempted = true
      result.registrationTx.error = errorMessage
      result.metadata.errorMessage = errorMessage
      
      // Update polling state if txId provided
      if (txId) {
        updateRegistrationMetadata(txId, result)
      }
      
      return result
    }

    // Step 4: Broadcast transaction
    logger.info('[NobleForwardingRegistration] Broadcasting registration transaction', {
      forwardingAddress: forwardingAddress.slice(0, 16) + '...',
    })

    try {
      const lcdClient = await createNobleLcdClient()
      const broadcastResult = await lcdClient.broadcastTransaction(txBytes, abortSignal)
      
      result.registrationTx.attempted = true
      const code = broadcastResult.tx_response.code
      const rawLog = (broadcastResult.tx_response.raw_log || '').toLowerCase()
      const txHash = broadcastResult.tx_response.txhash
      
      // Check if successful or already registered (both are success cases)
      const ok = code === 0 || rawLog.includes('already registered')
      
      if (ok) {
        logger.info('[NobleForwardingRegistration] Registration transaction successful', {
          forwardingAddress: forwardingAddress.slice(0, 16) + '...',
          txHash,
          code,
        })
        result.success = true
        result.registrationTx.txHash = txHash
        result.metadata.registeredAt = new Date().toISOString()
        result.metadata.registrationTxHash = txHash
      } else {
        const errorMessage = `Broadcast failed: ${rawLog || `code ${code}`}`
        logger.error('[NobleForwardingRegistration] Registration transaction failed', {
          forwardingAddress: forwardingAddress.slice(0, 16) + '...',
          txHash,
          code,
          rawLog,
        })
        result.registrationTx.error = errorMessage
        result.metadata.errorMessage = errorMessage
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to broadcast transaction'
      logger.error('[NobleForwardingRegistration] Transaction broadcast failed', {
        forwardingAddress: forwardingAddress.slice(0, 16) + '...',
        error: errorMessage,
      })
      result.registrationTx.attempted = true
      result.registrationTx.error = errorMessage
      result.metadata.errorMessage = errorMessage
    }

    // Update polling state if txId provided
    if (txId) {
      updateRegistrationMetadata(txId, result)
    }

    return result
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error('[NobleForwardingRegistration] Registration job failed', {
      txId,
      forwardingAddress: forwardingAddress.slice(0, 16) + '...',
      error: errorMessage,
    })
    result.metadata.errorMessage = errorMessage
    
    // Update polling state if txId provided
    if (txId) {
      updateRegistrationMetadata(txId, result)
    }
    
    return result
  }
}

/**
 * Update polling state with registration metadata
 * 
 * @param txId - Transaction ID
 * @param result - Registration job result
 */
function updateRegistrationMetadata(
  txId: string,
  result: NobleForwardingRegistrationJobResult,
): void {
  try {
    const tx = transactionStorageService.getTransaction(txId)
    if (!tx?.pollingState) {
      logger.warn('[NobleForwardingRegistration] Transaction or polling state not found', {
        txId,
      })
      return
    }

    // Update chain status metadata
    const currentMetadata = tx.pollingState.chainStatus.noble?.metadata || {}
    const updatedMetadata = {
      ...currentMetadata,
      nobleForwardingRegistration: {
        checkedAt: result.metadata.checkedAt,
        registrationNeeded: result.registrationNeeded,
        alreadyRegistered: result.alreadyRegistered,
        balanceCheck: {
          performed: result.balanceCheck.performed,
          sufficient: result.balanceCheck.sufficient,
          balanceUusdc: result.balanceCheck.balanceUusdc?.toString(),
          minRequiredUusdc: result.balanceCheck.minRequiredUusdc?.toString(),
          error: result.balanceCheck.error,
        },
        registrationTx: {
          attempted: result.registrationTx.attempted,
          txHash: result.registrationTx.txHash,
          error: result.registrationTx.error,
        },
        registeredAt: result.metadata.registeredAt,
        registrationTxHash: result.metadata.registrationTxHash,
        errorMessage: result.metadata.errorMessage,
      },
    }

    updateChainStatus(txId, 'noble', {
      metadata: updatedMetadata,
    })

    logger.debug('[NobleForwardingRegistration] Updated polling state with registration metadata', {
      txId,
      success: result.success,
      alreadyRegistered: result.alreadyRegistered,
      txHash: result.registrationTx.txHash,
    })
  } catch (error) {
    logger.error('[NobleForwardingRegistration] Failed to update polling state', {
      txId,
      error: error instanceof Error ? error.message : String(error),
    })
    // Don't throw - registration result should still be returned
  }
}

/**
 * Register Noble forwarding address (legacy function for backward compatibility)
 * 
 * @param params - Registration parameters
 * @returns Registration result
 */
export async function registerNobleForwarding(
  params: NobleForwardingRegistrationParams,
): Promise<NobleForwardingRegistrationResult> {
  const jobResult = await executeRegistrationJob({
    txId: params.txId,
    forwardingAddress: params.forwardingAddress,
    recipientAddress: params.recipientAddress,
    channelId: params.channelId,
  })

  return {
    success: jobResult.success,
    txHash: jobResult.registrationTx.txHash,
    error: jobResult.metadata.errorMessage,
  }
}

/**
 * Check if Noble forwarding address is already registered
 * 
 * @param forwardingAddress - Noble forwarding address (not used, kept for compatibility)
 * @param channelId - IBC channel ID
 * @param recipientAddress - Namada recipient address (required for check)
 * @returns True if address is registered
 */
export async function isNobleForwardingRegistered(
  forwardingAddress: string,
  channelId?: string,
  recipientAddress?: string,
): Promise<boolean> {
  // If recipientAddress is provided, use it for the check
  // Otherwise, we can't check without the recipient
  if (!recipientAddress) {
    logger.warn('[NobleForwardingRegistration] Cannot check registration without recipient address', {
      forwardingAddress: forwardingAddress.slice(0, 16) + '...',
    })
    return false
  }

  logger.debug('[NobleForwardingRegistration] Checking registration status', {
    forwardingAddress: forwardingAddress.slice(0, 16) + '...',
    recipientAddress: recipientAddress.slice(0, 16) + '...',
    channelId,
  })

  try {
    const status = await checkNobleForwardingRegistration(recipientAddress, channelId)
    
    // Log error if registration status could not be determined
    if (status.error) {
      logger.warn('[NobleForwardingRegistration] Could not determine registration status', {
        forwardingAddress: forwardingAddress.slice(0, 16) + '...',
        error: status.error,
      })
    }
    
    // Return false if error (can't determine status) or if not registered
    return status.error ? false : status.exists
  } catch (error) {
    logger.error('[NobleForwardingRegistration] Failed to check registration status', {
      forwardingAddress: forwardingAddress.slice(0, 16) + '...',
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}
