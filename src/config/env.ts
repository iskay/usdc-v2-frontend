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
  nobleLcdUrl: () => readEnvVar('VITE_NOBLE_LCD_URL'),
  nobleToNamadaChannel: () => readEnvVar('VITE_NOBLE_TO_NAMADA_CHANNEL') || 'channel-136',
  nobleDomainId: () => {
    const domainId = readEnvVar('VITE_NOBLE_DOMAIN_ID')
    return domainId ? Number.parseInt(domainId, 10) : 4
  },
  namadaRpc: () => readEnvVar('VITE_NAMADA_RPC_URL') || readEnvVar('VITE_NAMADA_RPC') || 'https://rpc.testnet.siuuu.click',
  namadaChainId: () => readEnvVar('VITE_NAMADA_CHAIN_ID', true),
  namadaToken: () => readEnvVar('VITE_NAMADA_NAM_TOKEN') || 'tnam1q9gr66cvu4hrzm0sd5kmlnjje82gs3xlfg3v6nu7',
  namadaMaspIndexerUrl: () => readEnvVar('VITE_NAMADA_MASP_INDEXER_URL') || 'https://masp.testnet.siuuu.click',
  namadaIndexerUrl: () => readEnvVar('VITE_NAMADA_INDEXER_URL') || 'https://indexer.testnet.siuuu.click',
  namadaDbName: () => readEnvVar('VITE_NAMADA_DB_NAME') || 'usdcdelivery',
  namadaMaspParamsUrl: () => readEnvVar('VITE_NAMADA_MASP_PARAMS_BASE_URL') || '/masp/',
  sharedWorkerPath: () => readEnvVar('VITE_SHIELDED_WORKER_PATH'),
  usdcTokenAddress: () => readEnvVar('VITE_USDC_TOKEN_ADDRESS'),
  debug: () => readEnvVar('VITE_DEBUG') === 'true' || readEnvVar('VITE_DEBUG') === '1',
  logLevel: () => readEnvVar('VITE_LOG_LEVEL') || 'info',
}

// TODO: Add typed helpers for chain configs and secret handling once values are defined.
