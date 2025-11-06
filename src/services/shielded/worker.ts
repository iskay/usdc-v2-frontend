/// <reference lib="webworker" />

import type { ShieldedWorkerMessage } from '@/types/shielded'

declare const self: DedicatedWorkerGlobalScope

self.addEventListener('message', (event) => {
  console.debug('[shielded-worker] received', event.data)
  // TODO: Initialize Namada WASM SDK and process sync requests inside worker context.
  const message: ShieldedWorkerMessage = { type: 'progress', payload: { step: 'stub' } }
  self.postMessage(message)
})
