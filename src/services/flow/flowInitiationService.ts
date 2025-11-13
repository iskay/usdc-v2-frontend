import type { FlowInitiationMetadata, ShieldedMetadata, StartFlowTrackingInput } from '@/types/flow'
import { flowStorageService } from './flowStorageService'
import { startFlowTracking } from '@/services/api/backendClient'
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
 */
class FlowInitiationService {
  /**
   * Initiate a new flow locally.
   * Creates flow initiation metadata and saves it to localStorage.
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
    
    // Save to localStorage
    flowStorageService.saveFlowInitiation(localId, initiationMetadata)
    
    logger.debug('[FlowInitiationService] Initiated flow', {
      localId,
      flowType,
      initialChain,
      amount,
    })
    
    return { localId }
  }

  /**
   * Register flow with backend after first transaction is broadcast.
   * Updates local metadata with backend flowId.
   * 
   * @param localId - Local flow identifier
   * @param firstTxHash - First transaction hash (required by backend)
   * @param metadata - Optional additional metadata to send to backend
   * @returns Backend flowId
   */
  async registerWithBackend(
    localId: string,
    firstTxHash: string,
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    const initiation = flowStorageService.getFlowInitiation(localId)
    if (!initiation) {
      throw new Error(`Flow initiation not found for localId: ${localId}`)
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
        ...metadata,
      },
    }
    
    try {
      // Register with backend
      const response = await startFlowTracking(input)
      const flowId = response.data.id
      
      // Update local metadata with flowId
      flowStorageService.updateFlowInitiation(localId, {
        flowId,
        status: 'tracking',
      })
      
      logger.debug('[FlowInitiationService] Registered flow with backend', {
        localId,
        flowId,
        txHash: firstTxHash.slice(0, 16) + '...',
      })
      
      return flowId
    } catch (error) {
      // Update status to failed but keep local metadata
      flowStorageService.updateFlowInitiation(localId, {
        status: 'failed',
      })
      
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('[FlowInitiationService] Failed to register flow with backend', {
        localId,
        error: errorMessage,
      })
      
      throw new Error(`Failed to register flow with backend: ${errorMessage}`)
    }
  }

  /**
   * Get flow initiation metadata by localId
   */
  getFlowInitiation(localId: string): FlowInitiationMetadata | null {
    return flowStorageService.getFlowInitiation(localId)
  }
}

// Export singleton instance
export const flowInitiationService = new FlowInitiationService()

