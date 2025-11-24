import type { TendermintChainsFile } from '@/config/chains'

const TENDERMINT_CHAINS_ENDPOINT = '/tendermint-chains.json'

export async function fetchTendermintChainsConfig(): Promise<TendermintChainsFile> {
  const response = await fetch(TENDERMINT_CHAINS_ENDPOINT, {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to load Tendermint chain configuration (${response.status})`)
  }

  const payload = (await response.json()) as TendermintChainsFile
  return payload
}
