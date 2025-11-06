import { getNamadaSdk, getNamadaSdkAccessors, isNamadaSdkReady } from './namadaSdkService'

export interface NamadaProvider {
  keychain?: unknown
  sign?: (payload: unknown) => Promise<Uint8Array>
}

/**
 * Get the Namada Keychain extension provider (browser extension).
 */
export function getNamadaProvider(): NamadaProvider | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as typeof window & { namada?: NamadaProvider }).namada
}

/**
 * Get the initialized Namada SDK instance.
 * Returns undefined if SDK is not ready.
 */
export function getNamadaSdkInstance() {
  if (!isNamadaSdkReady()) {
    return undefined
  }
  try {
    return getNamadaSdk()
  } catch {
    return undefined
  }
}

/**
 * Get Namada SDK accessors (sdk, tx, rpc, signing).
 * Returns undefined if SDK is not ready.
 */
export function getNamadaSdkAccessorsInstance() {
  if (!isNamadaSdkReady()) {
    return undefined
  }
  try {
    return getNamadaSdkAccessors()
  } catch {
    return undefined
  }
}

/**
 * Request shielded sync using the Namada SDK.
 * This is a placeholder that will be implemented when shielded sync service is ready.
 */
export async function requestShieldedSync(): Promise<void> {
  const sdk = getNamadaSdkInstance()
  if (!sdk) {
    throw new Error('Namada SDK is not initialized. Cannot perform shielded sync.')
  }
  // TODO: Implement shielded sync using SDK worker once shielded sync service is ready.
  console.debug('[NamadaClient] requestShieldedSync called (not yet implemented)', { sdkReady: true })
}
