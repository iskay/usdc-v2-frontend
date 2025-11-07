/**
 * Noble forwarding service for fetching Noble forwarding addresses
 * for Namada destination addresses via the Noble LCD endpoint.
 */

import { env } from '@/config/env'

export interface NobleForwardingResponse {
  address: string
}

/**
 * Fetches the Noble forwarding address for a given Namada address.
 * The forwarding address is used as the mint recipient in CCTP depositForBurn calls.
 *
 * @param namadaAddress - The Namada destination address (bech32 format)
 * @param channelId - Optional IBC channel ID (defaults to env config)
 * @returns The Noble forwarding address (bech32 format)
 * @throws Error if LCD URL is not configured or if the fetch fails
 */
export async function fetchNobleForwardingAddress(
  namadaAddress: string,
  channelId?: string
): Promise<string> {
  const lcdUrl = env.nobleLcdUrl()
  if (!lcdUrl) {
    throw new Error('VITE_NOBLE_LCD_URL not set. Please configure the Noble LCD endpoint.')
  }

  const channel = channelId || env.nobleToNamadaChannel()
  const url = `${lcdUrl}/noble/forwarding/v1/address/${channel}/${namadaAddress}/`

  console.debug('[NobleForwardingService] Fetching forwarding address', {
    namadaAddress,
    channel,
    url,
  })

  try {
    const response = await fetch(url)

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[NobleForwardingService] LCD response error', {
        status: response.status,
        statusText: response.statusText,
        errorText,
      })
      throw new Error(
        `Failed to fetch Noble forwarding address: ${response.status} - ${errorText}`
      )
    }

    const data = (await response.json()) as NobleForwardingResponse

    if (!data?.address) {
      throw new Error('No forwarding address returned from Noble LCD endpoint')
    }

    console.debug('[NobleForwardingService] Fetched forwarding address', {
      namadaAddress,
      forwardingAddress: data.address,
    })

    return data.address
  } catch (error) {
    console.error('[NobleForwardingService] Failed to fetch forwarding address', {
      namadaAddress,
      channel,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

