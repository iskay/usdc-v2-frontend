type EnvKey = `VITE_${string}`

function readEnvVar(key: EnvKey, required = false): string | undefined {
  const value = import.meta.env[key]
  if (required && !value) {
    // TODO: Replace console warn with centralized logging service.
    console.warn(`Missing required environment variable: ${key}`)
  }
  return value
}

export const env = {
  backendUrl: () => readEnvVar('VITE_BACKEND_URL'),
  nobleRpc: () => readEnvVar('VITE_NOBLE_RPC'),
  namadaRpc: () => readEnvVar('VITE_NAMADA_RPC'),
  namadaChainId: () => readEnvVar('VITE_NAMADA_CHAIN_ID', true),
  sharedWorkerPath: () => readEnvVar('VITE_SHIELDED_WORKER_PATH'),
}

// TODO: Add typed helpers for chain configs and secret handling once values are defined.
