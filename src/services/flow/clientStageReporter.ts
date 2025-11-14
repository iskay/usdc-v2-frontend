import type { ClientStageInput } from '@/types/flow'
import { reportClientStage } from '@/services/api/backendClient'
import { transactionStorageService } from '@/services/tx/transactionStorageService'
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
   * Resolve flowId from transaction ID, localId, or flowId.
   * 
   * @param identifier - Transaction ID, localId, or flowId
   * @returns Resolved flowId or null if not found or not yet registered
   */
  private async resolveFlowId(identifier: string): Promise<string | null> {
    // Try as transaction ID first
    let tx = transactionStorageService.getTransaction(identifier)
    if (tx?.flowId) {
      return tx.flowId
    }

    // Try as localId (look up transaction by flowMetadata.localId)
    tx = transactionStorageService.getTransactionByLocalId(identifier)
    if (tx?.flowId) {
      return tx.flowId
    }

    // Try as flowId (look up transaction by flowId)
    tx = transactionStorageService.getTransactionByFlowId(identifier)
    if (tx?.flowId) {
      return tx.flowId
    }

    // If identifier matches a flowId format but transaction not found, assume it's a flowId
    // (This handles cases where transaction might not be in storage yet)
    return identifier
  }
}

// Export singleton instance
export const clientStageReporter = new ClientStageReporter()

