import axios from 'axios'
import type { AxiosInstance, AxiosError } from 'axios'
import { env } from '@/config/env'
import type { BackendConfig, TxStatusResponse } from '@/types/api'
import type {
  StartFlowTrackingInput,
  StartFlowTrackingResponse,
  FlowStatus,
  ClientStageInput,
} from '@/types/flow'

let client: AxiosInstance | undefined

function getClient(): AxiosInstance {
  if (!client) {
    const cfg: BackendConfig = {
      baseUrl: env.backendUrl() ?? 'http://localhost:8787',
    }
    client = axios.create({
      baseURL: cfg.baseUrl,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return client
}

/**
 * @deprecated Use flow-based endpoints instead. This method is kept for backward compatibility only.
 * 
 * **Prefer using:**
 * - `getFlowStatus(flowId)` - Get flow status by flowId
 * - `lookupFlowByHash(chain, hash)` - Find flow by transaction hash
 * 
 * This method tries flow lookup first, then falls back to old endpoint.
 * It may be removed in a future version once all code migrates to flow-based endpoints.
 */
export async function fetchTxStatus(txId: string): Promise<TxStatusResponse | undefined> {
  if (!txId) return undefined
  
  // Try flow lookup first (assuming txId might be a transaction hash)
  // We'll try common chains, but this is a best-effort approach
  const commonChains = ['sepolia', 'base-sepolia', 'avalanche-fuji', 'polygon-amoy', 'namada-testnet', 'noble-testnet']
  for (const chain of commonChains) {
    try {
      const flowStatus = await lookupFlowByHash(chain, txId)
      if (flowStatus) {
        // Convert FlowStatus to TxStatusResponse format for backward compatibility
        return {
          txId: flowStatus.flowId,
          chain: chain,
          status: flowStatus.status,
          updatedAt: new Date(flowStatus.lastUpdated).toISOString(),
        }
      }
    } catch {
      // Continue to next chain or fallback
    }
  }
  
  // Fallback to old endpoint
  try {
    const response = await getClient().get<TxStatusResponse>(`/tx/${txId}`)
    return response.data
  } catch (error) {
    console.warn('Failed to fetch tx status', error)
    return undefined
  }
}

/**
 * Start flow tracking on backend.
 * Registers a new flow for tracking after the first transaction is broadcast.
 */
export async function startFlowTracking(
  input: StartFlowTrackingInput,
): Promise<StartFlowTrackingResponse> {
  try {
    const response = await getClient().post<StartFlowTrackingResponse>('/api/track/flow', input)
    return response.data
  } catch (error) {
    const axiosError = error as AxiosError
    throw new Error(
      `Failed to start flow tracking: ${axiosError.response?.status} ${axiosError.message}`,
    )
  }
}

/**
 * Get flow status from backend.
 * Returns the current status and chain progress for a flow.
 */
export async function getFlowStatus(flowId: string): Promise<FlowStatus> {
  try {
    const response = await getClient().get<{ data: FlowStatus }>(`/api/flow/${flowId}/status`)
    return response.data.data
  } catch (error) {
    const axiosError = error as AxiosError
    if (axiosError.response?.status === 404) {
      throw new Error(`Flow not found: ${flowId}`)
    }
    throw new Error(
      `Failed to get flow status: ${axiosError.response?.status} ${axiosError.message}`,
    )
  }
}

/**
 * Report a client-side stage to backend.
 * Used for stages that occur client-side (gasless swaps, wallet interactions).
 */
export async function reportClientStage(
  flowId: string,
  stage: ClientStageInput,
): Promise<void> {
  try {
    await getClient().post(`/api/flow/${flowId}/stage`, {
      ...stage,
      source: 'client' as const,
    })
  } catch (error) {
    const axiosError = error as AxiosError
    // Don't throw - client stage reporting is non-blocking
    console.warn(`Failed to report client stage for flow ${flowId}:`, axiosError.message)
  }
}

/**
 * Lookup flow by transaction hash and chain.
 * Useful for finding a flow when you only have a transaction hash.
 */
export async function lookupFlowByHash(
  chain: string,
  hash: string,
): Promise<FlowStatus | null> {
  try {
    const response = await getClient().get<{ data: FlowStatus }>(
      `/api/flow/by-hash/${chain}/${hash}`,
    )
    return response.data.data
  } catch (error) {
    const axiosError = error as AxiosError
    if (axiosError.response?.status === 404) {
      return null
    }
    console.warn(`Failed to lookup flow by hash ${hash} on ${chain}:`, axiosError.message)
    return null
  }
}
