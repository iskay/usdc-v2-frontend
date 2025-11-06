import { atom } from 'jotai'
import { isNamadaSdkReady, getNamadaSdkError } from '@/services/namada/namadaSdkService'

export interface NamadaSdkState {
  isReady: boolean
  error: string | null
}

/**
 * Atom that tracks Namada SDK initialization state.
 * Updated by the SDK service when initialization completes or fails.
 */
export const namadaSdkAtom = atom<NamadaSdkState>(() => {
  const isReady = isNamadaSdkReady()
  const error = getNamadaSdkError()
  return {
    isReady,
    error: error?.message ?? null,
  }
})

/**
 * Derived atom that provides a simple boolean for SDK readiness.
 */
export const isNamadaSdkReadyAtom = atom((get) => get(namadaSdkAtom).isReady)

/**
 * Derived atom that provides the SDK error message, if any.
 */
export const namadaSdkErrorAtom = atom((get) => get(namadaSdkAtom).error)

