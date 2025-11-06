import { atom } from 'jotai'
import type { EvmChainsFile } from '@/config/chains'

export interface AppInitState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error?: string
}

export const appInitAtom = atom<AppInitState>({ status: 'idle' })
export const chainConfigAtom = atom<EvmChainsFile | undefined>(undefined)
