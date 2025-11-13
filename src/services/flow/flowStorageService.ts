import type { FlowInitiationMetadata } from '@/types/flow'
import { deleteItem, loadItem, saveItem } from '@/services/storage/localStore'

const STORAGE_KEY = 'usdc-v2-flows'

/**
 * Service for managing flow initiation metadata in localStorage.
 * This replaces the old separate payment/deposit storage with a unified flow-based model.
 */
class FlowStorageService {
  /**
   * Save or update flow initiation metadata
   */
  saveFlowInitiation(localId: string, metadata: FlowInitiationMetadata): void {
    const flows = this.getAllFlowInitiations()
    const existingIndex = flows.findIndex((f) => f.localId === localId)
    
    if (existingIndex >= 0) {
      flows[existingIndex] = metadata
    } else {
      flows.push(metadata)
    }
    
    saveItem(STORAGE_KEY, flows)
  }

  /**
   * Get flow initiation metadata by localId
   */
  getFlowInitiation(localId: string): FlowInitiationMetadata | null {
    const flows = this.getAllFlowInitiations()
    return flows.find((f) => f.localId === localId) || null
  }

  /**
   * Get flow initiation metadata by backend flowId
   */
  getFlowInitiationByFlowId(flowId: string): FlowInitiationMetadata | null {
    const flows = this.getAllFlowInitiations()
    return flows.find((f) => f.flowId === flowId) || null
  }

  /**
   * Get all flow initiations
   */
  getAllFlowInitiations(): FlowInitiationMetadata[] {
    const flows = loadItem<FlowInitiationMetadata[]>(STORAGE_KEY)
    return flows || []
  }

  /**
   * Get flow initiations filtered by type
   */
  getFlowInitiationsByType(flowType: 'deposit' | 'payment'): FlowInitiationMetadata[] {
    const flows = this.getAllFlowInitiations()
    return flows.filter((f) => f.flowType === flowType)
  }

  /**
   * Update flow initiation metadata
   */
  updateFlowInitiation(localId: string, updates: Partial<FlowInitiationMetadata>): void {
    const flows = this.getAllFlowInitiations()
    const index = flows.findIndex((f) => f.localId === localId)
    
    if (index >= 0) {
      flows[index] = { ...flows[index], ...updates }
      saveItem(STORAGE_KEY, flows)
    }
  }

  /**
   * Delete flow initiation metadata
   */
  deleteFlowInitiation(localId: string): void {
    const flows = this.getAllFlowInitiations()
    const filtered = flows.filter((f) => f.localId !== localId)
    saveItem(STORAGE_KEY, filtered)
  }
}

// Export singleton instance
export const flowStorageService = new FlowStorageService()

