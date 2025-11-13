import { atom } from 'jotai'
import type { TrackedTransaction } from '@/types/tx'

export interface TxState {
  activeTransaction?: TrackedTransaction
  history: TrackedTransaction[]
}

export const txAtom = atom<TxState>({
  activeTransaction: undefined,
  history: [],
})

export const txFilterAtom = atom<'all' | 'pending' | 'completed'>('all')

// NOTE: Transaction hydration from localStorage will be implemented in Task 1.5
// (Implement Transaction Hydration on App Startup)
