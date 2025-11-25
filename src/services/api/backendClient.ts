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
 * @deprecated LEGACY_BACKEND_CODE - This function registers flows with the backend for backend-managed polling.
 * 
 * **Migration Path:**
 * - Frontend polling no longer requires backend registration
 * - Transactions are tracked directly via `chainPollingService` after saving
 * - This function is kept for backward compatibility during migration
 * - Set `VITE_ENABLE_FRONTEND_POLLING=true` to use frontend polling instead
 * 
 * **Removal Plan:**
 * - This function can be removed once all transactions use frontend polling
 * - Check `ENABLE_FRONTEND_POLLING` feature flag before removing
 * - Remove `/api/track/flow` endpoint calls
 * 
 * @see chainPollingService.startDepositPolling()
 * @see chainPollingService.startPaymentPolling()
 * @see ENABLE_FRONTEND_POLLING feature flag
 * 
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
 * @deprecated LEGACY_BACKEND_CODE - This function queries backend for flow status.
 * 
 * **Migration Path:**
 * - Frontend polling now reads status directly from `pollingState` in transaction storage
 * - This function is kept for backward compatibility during migration
 * - Set `VITE_ENABLE_FRONTEND_POLLING=true` to use frontend polling instead
 * 
 * **Removal Plan:**
 * - This function can be removed once all transactions use frontend polling
 * - Check `ENABLE_FRONTEND_POLLING` feature flag before removing
 * - Remove `/api/flow/${flowId}/status` endpoint calls
 * - Remove `flowStatusPoller` usage
 * 
 * @see pollingStateManager.getPollingState()
 * @see pollingStatusUtils.getPollingStatus()
 * @see ENABLE_FRONTEND_POLLING feature flag
 * 
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

export interface TrackNobleForwardingInput {
  nobleAddress: string
  recipient: string
  channel?: string
  fallback?: string
}

export interface TrackNobleForwardingResponse {
  tracked: boolean
  reason?: string
  data?: {
    id: string
    nobleAddress: string
    recipient: string
    channel: string
    fallback: string | null
    status: 'pending' | 'registered' | 'failed' | 'stale'
    balanceUusdc: string | null
    lastCheckedAt: string | null
    registeredAt: string | null
    registrationTxHash: string | null
    errorMessage: string | null
    createdAt: string
    updatedAt: string
  }
}

/**
 * Track Noble forwarding address for registration monitoring.
 * Registers a Noble forwarding address with the backend so it can monitor
 * and automatically register it when sufficient balance is received.
 */
export async function trackNobleForwarding(
  input: TrackNobleForwardingInput,
): Promise<TrackNobleForwardingResponse> {
  try {
    const response = await getClient().post<TrackNobleForwardingResponse>(
      '/api/noble-forwarding/track',
      input,
    )
    return response.data
  } catch (error) {
    const axiosError = error as AxiosError
    throw new Error(
      `Failed to track Noble forwarding address: ${axiosError.response?.status} ${axiosError.message}`,
    )
  }
}
