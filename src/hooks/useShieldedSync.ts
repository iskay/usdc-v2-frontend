import { useCallback } from 'react'
import { useAtom } from 'jotai'
import { shieldedAtom, shieldedProgressAtom } from '@/atoms/shieldedAtom'
import type { ShieldedWorkerMessage } from '@/types/shielded'

export function useShieldedSync() {
  const [shieldedState, setShieldedState] = useAtom(shieldedAtom)
  const [, setProgress] = useAtom(shieldedProgressAtom)

  const startSync = useCallback(() => {
    setShieldedState((state) => ({ ...state, isSyncing: true, lastError: undefined }))
    // TODO: Spawn shielded/worker.ts web worker and initiate sync via shieldedService.
  }, [setShieldedState])

  const handleWorkerMessage = useCallback(
    (message: ShieldedWorkerMessage) => {
      switch (message.type) {
        case 'progress':
          setProgress((value) => Math.min(100, value + 1))
          break
        case 'complete':
          setShieldedState((state) => ({ ...state, isSyncing: false, lastSyncedHeight: Date.now() }))
          setProgress(100)
          break
        case 'error':
          setShieldedState((state) => ({ ...state, isSyncing: false, lastError: 'Shielded sync failed.' }))
          break
        default:
          console.warn('Unhandled shielded worker message', message)
      }
    },
    [setProgress, setShieldedState],
  )

  return { state: shieldedState, startSync, handleWorkerMessage }
}
