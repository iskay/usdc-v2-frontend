// If using Vite, inline build is recommended per SDK docs
import { initSdk } from '@namada/sdk-multicore/inline'
import type { Sdk } from '@namada/sdk-multicore'
import { env } from '@/config/env'
import { getTendermintMaspIndexerUrl, getTendermintRpcUrl } from '@/services/polling/tendermintRpcClient'
import { getDefaultNamadaChainKey } from '@/config/chains'
import { fetchTendermintChainsConfig } from '@/services/config/tendermintChainConfigService'

// Guard against double initialization
let sdkInitPromise: Promise<Sdk> | null = null
let sdkInstance: Sdk | null = null
let initError: Error | null = null
let initLogged = false

export interface NamadaSdkConfig {
  rpcUrl?: string
  token?: string
  maspIndexerUrl?: string
  dbName?: string
}

// SDK accessors - using unknown since SDK types don't expose these directly
export interface NamadaSdkAccessors {
  sdk: Sdk
  tx: unknown
  rpc: unknown
  signing: unknown
}

/**
 * Initialize the Namada SDK once (singleton pattern).
 * Subsequent calls return the same promise.
 */
function initSdkOnce(options: { rpcUrl: string; token: string; maspIndexerUrl?: string; dbName?: string }): Promise<Sdk> {
  if (!sdkInitPromise) {
    sdkInitPromise = initSdk(options)
      .then((sdk) => {
        sdkInstance = sdk
        initError = null
        return sdk
      })
      .catch((e) => {
        // Allow retry on next call if init failed
        sdkInitPromise = null
        initError = e instanceof Error ? e : new Error(String(e))
        throw initError
      })
  }
  return sdkInitPromise
}

/**
 * Initialize the Namada SDK with configuration from environment variables.
 * Uses fallback values if env vars are not set.
 */
export async function initializeNamadaSdk(config?: Partial<NamadaSdkConfig>): Promise<Sdk> {
  // Get values from chain config (with fallback to env)
  const tendermintConfig = await fetchTendermintChainsConfig()
  const namadaChainKey = getDefaultNamadaChainKey(tendermintConfig) || 'namada-testnet'
  
  const effectiveRpcUrl = config?.rpcUrl ?? await getTendermintRpcUrl(namadaChainKey)
  const effectiveToken = config?.token ?? env.namadaToken()
  
  // Get masp indexer URL from config (with fallback to env)
  let effectiveMaspIndexerUrl = config?.maspIndexerUrl
  if (!effectiveMaspIndexerUrl) {
    effectiveMaspIndexerUrl = await getTendermintMaspIndexerUrl(namadaChainKey)
  }
  
  const effectiveDbName = config?.dbName ?? env.namadaDbName()

  // Ensure required values are present
  if (!effectiveRpcUrl || !effectiveToken) {
    throw new Error('Namada SDK requires rpcUrl and token to be configured')
  }

  const sdkOptions: { rpcUrl: string; token: string; maspIndexerUrl?: string; dbName?: string } = {
    rpcUrl: effectiveRpcUrl,
    token: effectiveToken,
  }
  if (effectiveMaspIndexerUrl) {
    sdkOptions.maspIndexerUrl = effectiveMaspIndexerUrl
  }
  if (effectiveDbName) {
    sdkOptions.dbName = effectiveDbName
  }

  try {
    const sdk = await initSdkOnce(sdkOptions)

    // Basic diagnostics for init success
    if (!initLogged) {
      // SDK exposes tx, rpc, signing but types aren't fully exposed
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { tx, rpc, signing } = sdk as any
      console.info('[Namada SDK] Initialized', {
        rpcUrl: effectiveRpcUrl,
        maspIndexerUrl: effectiveMaspIndexerUrl,
        dbName: effectiveDbName,
        hasRpc: !!rpc,
        hasTx: !!tx,
        hasSigning: !!signing,
        crossOriginIsolated: typeof self !== 'undefined' && (self as { crossOriginIsolated?: boolean }).crossOriginIsolated,
        hasSAB: typeof SharedArrayBuffer !== 'undefined',
      })
      initLogged = true
    }

    return sdk
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to initialize Namada SDK'
    if (!initLogged) {
      console.error('[Namada SDK] Initialization error:', e)
      initLogged = true
    }
    throw new Error(message)
  }
}

/**
 * Get the initialized SDK instance.
 * Throws if SDK has not been initialized or initialization failed.
 */
export function getNamadaSdk(): Sdk {
  if (!sdkInstance) {
    if (initError) {
      throw new Error(`Namada SDK initialization failed: ${initError.message}`)
    }
    throw new Error('Namada SDK has not been initialized. Call initializeNamadaSdk() first.')
  }
  return sdkInstance
}

/**
 * Get SDK accessors (sdk, tx, rpc, signing).
 * Throws if SDK has not been initialized.
 */
export function getNamadaSdkAccessors(): NamadaSdkAccessors {
  const sdk = getNamadaSdk()
  // SDK exposes tx, rpc, signing but types aren't fully exposed
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { tx, rpc, signing } = sdk as any
  return { sdk, tx, rpc, signing }
}

/**
 * Check if the SDK is ready (initialized and available).
 */
export function isNamadaSdkReady(): boolean {
  return sdkInstance !== null
}

/**
 * Get the current initialization error, if any.
 */
export function getNamadaSdkError(): Error | null {
  return initError
}

/**
 * Reset the SDK state (useful for testing or retry scenarios).
 * Note: This does not clean up the SDK instance, just resets the internal state.
 */
export function resetNamadaSdkState(): void {
  sdkInitPromise = null
  sdkInstance = null
  initError = null
  initLogged = false
}

