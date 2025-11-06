export interface BackendConfig {
  baseUrl: string
  apiKey?: string
}

export interface TxStatusResponse {
  txId: string
  chain: string
  status: string
  updatedAt: string
}

export interface ApiError {
  message: string
  code?: string
  details?: unknown
}

// TODO: Align interfaces with backend contract once endpoints are finalized.
