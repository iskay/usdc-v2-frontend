/**
 * Noble forwarding service for fetching Noble forwarding addresses
 * for Namada destination addresses via the Noble LCD endpoint.
 */

import { env } from '@/config/env'

export interface NobleForwardingResponse {
  address: string
  exists?: boolean
}

export interface NobleRegistrationStatus {
  exists: boolean
  address?: string
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

/**
 * Checks if the Noble forwarding address for a given Namada address is already registered.
 * This is used to determine if the Noble registration fee ($0.02) should be included in the total fee.
 *
 * @param namadaAddress - The Namada destination address (bech32 format)
 * @param channelId - Optional IBC channel ID (defaults to env config)
 * @returns Registration status with exists flag and forwarding address (if available)
 */
export async function checkNobleForwardingRegistration(
  namadaAddress: string,
  channelId?: string
): Promise<NobleRegistrationStatus> {
  const lcdUrl = env.nobleLcdUrl()
  if (!lcdUrl) {
    // If LCD URL is not configured, assume not registered (include fee)
    console.warn('[NobleForwardingService] LCD URL not configured, assuming not registered')
    return { exists: false }
  }

  const channel = channelId || env.nobleToNamadaChannel()
  const url = `${lcdUrl}/noble/forwarding/v1/address/${channel}/${namadaAddress}/`

  console.debug('[NobleForwardingService] Checking Noble forwarding registration', {
    namadaAddress,
    channel,
    url,
  })

  try {
    const response = await fetch(url)

    if (!response.ok) {
      // If response is not OK, assume not registered (include fee)
      console.debug('[NobleForwardingService] LCD response not OK, assuming not registered', {
        status: response.status,
        statusText: response.statusText,
      })
      return { exists: false }
    }

    const data = (await response.json()) as NobleForwardingResponse

    const exists = Boolean(data?.exists)
    const address = data?.address

    console.debug('[NobleForwardingService] Noble forwarding registration status', {
      namadaAddress,
      exists,
      forwardingAddress: address,
    })

    return {
      exists,
      address,
    }
  } catch (error) {
    // On error, assume not registered (include fee)
    console.warn('[NobleForwardingService] Failed to check Noble forwarding registration, assuming not registered', {
      namadaAddress,
      channel,
      error: error instanceof Error ? error.message : String(error),
    })
    return { exists: false }
  }
}

