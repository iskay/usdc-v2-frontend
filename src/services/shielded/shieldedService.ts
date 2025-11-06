export interface ShieldedSyncParams {
  viewingKey: string
  chainId: string
}

export async function startShieldedSync(params: ShieldedSyncParams): Promise<void> {
  console.debug('startShieldedSync', params)
  // TODO: Spawn worker.ts and post message to begin MASP sync using Namada SDK WASM APIs.
}

export async function stopShieldedSync(): Promise<void> {
  // TODO: Terminate worker instance and clean up caches if necessary.
}
