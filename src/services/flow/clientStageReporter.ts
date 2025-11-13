import type { ClientStageInput } from '@/types/flow'
import { reportClientStage } from '@/services/api/backendClient'
import { flowStorageService } from './flowStorageService'
import { logger } from '@/utils/logger'

/**
 * Service for reporting client-side stages to backend.
 * Used for stages that occur client-side (gasless swaps, wallet interactions)
 * that the backend cannot observe directly.
 */
class ClientStageReporter {
  /**
   * Report a client-side stage to backend.
   * 
   * @param flowId - Backend flowId (or localId, will be resolved)
   * @param chain - Chain where stage occurred
   * @param stage - Stage identifier
   * @param details - Additional stage details
   */
  async reportStage(
    flowId: string,
    chain: 'evm' | 'noble' | 'namada',
    stage: string,
    details: Partial<ClientStageInput> = {},
  ): Promise<void> {
    try {
      // Resolve flowId if localId provided
      const resolvedFlowId = await this.resolveFlowId(flowId)
      if (!resolvedFlowId) {
        logger.warn('[ClientStageReporter] Cannot report stage, flowId not found', {
          flowId,
          chain,
          stage,
        })
        return
      }

      const stageInput: ClientStageInput = {
        chain,
        stage,
        source: 'client',
        occurredAt: new Date().toISOString(),
        ...details,
      }

      await reportClientStage(resolvedFlowId, stageInput)

      logger.debug('[ClientStageReporter] Reported client stage', {
        flowId: resolvedFlowId,
        chain,
        stage,
      })
    } catch (error) {
      // Don't throw - client stage reporting is non-blocking
      logger.warn('[ClientStageReporter] Failed to report stage', {
        flowId,
        chain,
        stage,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Report a gasless swap stage to backend.
   * 
   * @param flowId - Backend flowId (or localId, will be resolved)
   * @param stage - Gasless stage identifier (e.g., 'gasless_quote_pending', 'gasless_swap_completed')
   * @param txHash - Optional transaction hash
   * @param status - Stage status
   */
  async reportGaslessStage(
    flowId: string,
    stage: string,
    txHash?: string,
    status?: 'pending' | 'confirmed' | 'failed',
  ): Promise<void> {
    await this.reportStage(flowId, 'evm', stage, {
      kind: 'gasless',
      txHash,
      status,
    })
  }

  /**
   * Report a wallet interaction stage to backend.
   * 
   * @param flowId - Backend flowId (or localId, will be resolved)
   * @param stage - Wallet stage identifier (e.g., 'wallet_signing', 'wallet_broadcasting')
   * @param chain - Chain where interaction occurred
   * @param txHash - Optional transaction hash
   * @param status - Stage status
   */
  async reportWalletStage(
    flowId: string,
    stage: string,
    chain: 'evm' | 'noble' | 'namada',
    txHash?: string,
    status?: 'pending' | 'confirmed' | 'failed',
  ): Promise<void> {
    await this.reportStage(flowId, chain, stage, {
      txHash,
      status,
    })
  }

  /**
   * Resolve flowId from localId or return flowId if already resolved.
   * 
   * @param identifier - localId or flowId
   * @returns Resolved flowId or null if not found or not yet registered
   */
  private async resolveFlowId(identifier: string): Promise<string | null> {
    // Try as localId first
    const flowInitiation = flowStorageService.getFlowInitiation(identifier)
    if (flowInitiation?.flowId) {
      // Only return flowId if flow has been registered with backend
      return flowInitiation.flowId
    }

    // Try as flowId (check if identifier is a registered flowId)
    const flowInitiationByFlowId = flowStorageService.getFlowInitiationByFlowId(identifier)
    if (flowInitiationByFlowId?.flowId) {
      return flowInitiationByFlowId.flowId
    }

    // Don't assume UUID format = flowId (localId is also UUID format)
    // Only return flowId if it's actually registered in our local storage
    return null
  }
}

// Export singleton instance
export const clientStageReporter = new ClientStageReporter()

