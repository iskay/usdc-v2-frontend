import type { FlowInitiationMetadata, ShieldedMetadata, StartFlowTrackingInput } from '@/types/flow'
import { startFlowTracking } from '@/services/api/backendClient'
import { transactionStorageService } from '@/services/tx/transactionStorageService'
import { jotaiStore } from '@/store/jotaiStore'
import { chainConfigAtom } from '@/atoms/appAtom'
import { findChainByKey, getDefaultNamadaChainKey } from '@/config/chains'
import { fetchTendermintChainsConfig } from '@/services/config/tendermintChainConfigService'
import { logger } from '@/utils/logger'

/**
 * Determine chain type based on chain identifier.
 * Checks if chain is in EVM chains config, otherwise assumes Tendermint.
 */
function getChainType(chainKey: string): 'evm' | 'tendermint' {
  const chainConfig = jotaiStore.get(chainConfigAtom)
  if (chainConfig) {
    const chain = findChainByKey(chainConfig, chainKey)
    if (chain) {
      return 'evm'
    }
  }
  
  // Namada and Noble are Tendermint chains
  if (chainKey.toLowerCase().includes('namada') || chainKey.toLowerCase().includes('noble')) {
    return 'tendermint'
  }
  
  // Default to tendermint for unknown chains
  return 'tendermint'
}

/**
 * Service for initiating flows and registering them with the backend.
 * Flow metadata is now stored directly in transactions instead of separate flows storage.
 */
class FlowInitiationService {
  /**
   * Create flow initiation metadata.
   * This creates the metadata object but does NOT save it - it should be stored in the transaction's flowMetadata field.
   * 
   * @param flowType - Type of flow ('deposit' or 'payment')
   * @param initialChain - Chain identifier where flow starts
   * @param amount - Token amount in base units
   * @param shieldedMetadata - Optional shielded transaction metadata (client-side only)
   * @returns Flow initiation metadata with localId
   */
  createFlowMetadata(
    flowType: 'deposit' | 'payment',
    initialChain: string,
    amount: string,
    shieldedMetadata?: ShieldedMetadata,
  ): FlowInitiationMetadata {
    const localId = crypto.randomUUID()
    const initialChainType = getChainType(initialChain)
    
    const initiationMetadata: FlowInitiationMetadata = {
      localId,
      flowType,
      initialChain,
      initialChainType,
      amount,
      token: 'USDC',
      shieldedMetadata,
      initiatedAt: Date.now(),
      status: 'initiating',
    }
    
    logger.debug('[FlowInitiationService] Created flow metadata', {
      localId,
      flowType,
      initialChain,
      amount,
    })
    
    return initiationMetadata
  }

  /**
   * Initiate a new flow locally.
   * Creates flow initiation metadata and saves it to transaction storage.
   * 
   * @deprecated Use createFlowMetadata() and store in transaction's flowMetadata field instead.
   * This method is kept for backward compatibility but will be removed.
   * 
   * @param flowType - Type of flow ('deposit' or 'payment')
   * @param initialChain - Chain identifier where flow starts
   * @param amount - Token amount in base units
   * @param shieldedMetadata - Optional shielded transaction metadata (client-side only)
   * @returns Object with localId
   */
  async initiateFlow(
    flowType: 'deposit' | 'payment',
    initialChain: string,
    amount: string,
    shieldedMetadata?: ShieldedMetadata,
  ): Promise<{ localId: string }> {
    const metadata = this.createFlowMetadata(flowType, initialChain, amount, shieldedMetadata)
    return { localId: metadata.localId }
  }

  /**
   * Register flow with backend after first transaction is broadcast.
   * Updates transaction with backend flowId.
   * 
   * @param txId - Transaction ID (to find transaction and update it)
   * @param firstTxHash - First transaction hash (required by backend)
   * @param metadata - Optional additional metadata to send to backend
   * @returns Backend flowId
   */
  async registerWithBackend(
    txId: string,
    firstTxHash: string,
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    // Get transaction to find flow metadata
    const tx = transactionStorageService.getTransaction(txId)
    if (!tx) {
      throw new Error(`Transaction not found for txId: ${txId}`)
    }

    const initiation = tx.flowMetadata
    if (!initiation) {
      throw new Error(`Flow metadata not found in transaction: ${txId}`)
    }
    
    // Determine destinationChain based on flow type
    let destinationChain: string
    if (initiation.flowType === 'deposit') {
      // Deposits always go to Namada - get from tendermint chains config
      try {
        const tendermintConfig = await fetchTendermintChainsConfig()
        destinationChain = getDefaultNamadaChainKey(tendermintConfig) || 'namada-testnet'
      } catch (error) {
        logger.warn('[FlowInitiationService] Failed to load tendermint chains config, using fallback', {
          error: error instanceof Error ? error.message : String(error),
        })
        destinationChain = 'namada-testnet'
      }
    } else {
      // For payments, extract destinationChain from metadata
      const destinationChainFromMetadata = metadata?.destinationChain as string | undefined
      if (destinationChainFromMetadata) {
        // Use provided destinationChain from metadata (e.g., "Base" -> "base")
        destinationChain = destinationChainFromMetadata.toLowerCase().replace(/\s+/g, '-')
      } else {
        // Fallback to default chain from config if not provided
        const chainConfig = jotaiStore.get(chainConfigAtom)
        const defaultChainKey = chainConfig?.defaults?.selectedChainKey
        if (defaultChainKey) {
          destinationChain = defaultChainKey
        } else {
          // Last resort: use first available chain from config
          const firstChain = chainConfig?.chains?.[0]
          if (firstChain) {
            destinationChain = firstChain.key
          } else {
            // If no config available, log warning and use a safe fallback
            logger.warn('[FlowInitiationService] No chain config available, using fallback', {
              flowType: initiation.flowType,
            })
            destinationChain = 'sepolia' // Safe fallback for testnet
          }
        }
      }
    }
    
    // Build backend request payload
    const input: StartFlowTrackingInput = {
      flowType: initiation.flowType,
      initialChain: initiation.initialChain,
      destinationChain,
      chainType: initiation.initialChainType,
      txHash: firstTxHash,
      metadata: {
        amount: initiation.amount,
        token: initiation.token,
        localId: initiation.localId, // Include frontend localId for recovery
        ...metadata,
      },
    }
    
    try {
      // Register with backend
      const response = await startFlowTracking(input)
      const flowId = response.data.id
      
      // Update transaction with flowId and updated flow metadata
      const updatedFlowMetadata: FlowInitiationMetadata = {
        ...initiation,
        flowId,
        status: 'tracking',
      }
      
      transactionStorageService.updateTransaction(txId, {
        flowId,
        flowMetadata: updatedFlowMetadata,
      })
      
      logger.debug('[FlowInitiationService] Registered flow with backend', {
        txId,
        localId: initiation.localId,
        flowId,
        txHash: firstTxHash.slice(0, 16) + '...',
      })
      
      return flowId
    } catch (error) {
      // Update transaction status to failed but keep flow metadata
      const updatedFlowMetadata: FlowInitiationMetadata = {
        ...initiation,
        status: 'failed',
      }
      
      transactionStorageService.updateTransaction(txId, {
        flowMetadata: updatedFlowMetadata,
      })
      
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('[FlowInitiationService] Failed to register flow with backend', {
        txId,
        localId: initiation.localId,
        error: errorMessage,
      })
      
      throw new Error(`Failed to register flow with backend: ${errorMessage}`)
    }
  }

  /**
   * Get flow initiation metadata by localId (from transaction).
   * @deprecated Use transactionStorageService.getTransactionByLocalId() instead.
   */
  getFlowInitiation(localId: string): FlowInitiationMetadata | null {
    const tx = transactionStorageService.getTransactionByLocalId(localId)
    return tx?.flowMetadata || null
  }
}

// Export singleton instance
export const flowInitiationService = new FlowInitiationService()

