export interface NamadaProvider {
  keychain?: unknown
  sign?: (payload: unknown) => Promise<Uint8Array>
}

export function getNamadaProvider(): NamadaProvider | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as typeof window & { namada?: NamadaProvider }).namada
}

export async function requestShieldedSync(): Promise<void> {
  // TODO: Call Namada SDK worker once available.
}
