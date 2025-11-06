import { atom } from 'jotai'
import type { ShieldedSyncState } from '@/types/shielded'

export const shieldedAtom = atom<ShieldedSyncState>({
  isSyncing: false,
  status: 'idle',
  lastSyncedHeight: undefined,
  lastError: undefined,
})

export const shieldedProgressAtom = atom<number>(0)
