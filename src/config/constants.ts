import { env } from './env'

export const NAMADA_CHAIN_ID = env.namadaChainId() ?? 'housefire-alpaca.cc0d3e0c033be'
export const DEFAULT_POLL_INTERVAL_MS = 5_000
export const DEFAULT_TOAST_DURATION_MS = 6_000

export const SHIELDED_WORKER_NAME = 'shielded-sync-worker'

// TODO: Centralize additional magic numbers and timeouts here as flows mature.
