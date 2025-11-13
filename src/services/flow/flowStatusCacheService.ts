import type { FlowStatus } from '@/types/flow'
import { deleteItem, loadItem, saveItem } from '@/services/storage/localStore'

const STORAGE_KEY = 'usdc-v2-flow-status-cache'

/**
 * Service for caching backend flow status locally.
 * Used for offline access and to reduce backend polling frequency.
 */
class FlowStatusCacheService {
  /**
   * Cache flow status from backend
   */
  cacheFlowStatus(flowId: string, status: FlowStatus): void {
    const cache = this.getAllCachedStatuses()
    cache[flowId] = status
    saveItem(STORAGE_KEY, cache)
  }

  /**
   * Get cached flow status by flowId
   */
  getCachedFlowStatus(flowId: string): FlowStatus | null {
    const cache = this.getAllCachedStatuses()
    return cache[flowId] || null
  }

  /**
   * Get all cached flow statuses
   */
  getAllCachedStatuses(): Record<string, FlowStatus> {
    const cache = loadItem<Record<string, FlowStatus>>(STORAGE_KEY)
    return cache || {}
  }

  /**
   * Clear cache for a specific flowId, or all caches if flowId is not provided
   */
  clearCache(flowId?: string): void {
    if (flowId) {
      const cache = this.getAllCachedStatuses()
      delete cache[flowId]
      saveItem(STORAGE_KEY, cache)
    } else {
      // Clear all cache
      deleteItem(STORAGE_KEY)
    }
  }
}

// Export singleton instance
export const flowStatusCacheService = new FlowStatusCacheService()

