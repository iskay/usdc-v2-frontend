import axios from 'axios'
import type { AxiosInstance } from 'axios'
import { env } from '@/config/env'
import type { BackendConfig, TxStatusResponse } from '@/types/api'

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

export async function fetchTxStatus(txId: string): Promise<TxStatusResponse | undefined> {
  if (!txId) return undefined
  try {
    const response = await getClient().get<TxStatusResponse>(`/tx/${txId}`)
    return response.data
  } catch (error) {
    console.warn('Failed to fetch tx status', error)
    return undefined
  }
}

// TODO: Add deposit/payment mutation endpoints when backend API is ready.
