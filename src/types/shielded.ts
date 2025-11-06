export interface ShieldedSyncState {
  isSyncing: boolean
  lastSyncedHeight?: number
  lastError?: string
}

export interface ShieldedWorkerMessage {
  type: 'progress' | 'complete' | 'error'
  payload?: unknown
}

// TODO: Define precise payload types once Namada SDK wiring is implemented.
