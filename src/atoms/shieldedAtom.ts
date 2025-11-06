import { atom } from 'jotai'
import type { ShieldedSyncState } from '@/types/shielded'

export const shieldedAtom = atom<ShieldedSyncState>({
  isSyncing: false,
  lastSyncedHeight: undefined,
  lastError: undefined,
})

export const shieldedProgressAtom = atom<number>(0)

// TODO: Update sync progress from shieldedService worker messages.
