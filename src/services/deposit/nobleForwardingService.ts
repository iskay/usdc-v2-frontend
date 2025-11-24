/**
 * Noble forwarding service for fetching Noble forwarding addresses
 * for Namada destination addresses via the Noble LCD endpoint.
 */

import { env } from '@/config/env'
import { jotaiStore } from '@/store/jotaiStore'
import { depositRecipientAddressAtom } from '@/atoms/appAtom'

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

/**
 * Checks if the current deposit recipient tnam address has been registered as a Noble forwarding address.
 * This function automatically uses the deposit recipient address from global state if no address is provided.
 * 
 * This is a convenience wrapper around checkNobleForwardingRegistration that can be called from anywhere
 * without needing to pass the recipient address explicitly.
 *
 * @param namadaAddress - Optional Namada destination address (bech32 format). If not provided, uses the current deposit recipient address from global state.
 * @param channelId - Optional IBC channel ID (defaults to env config)
 * @returns Registration status with exists flag and forwarding address (if available)
 * @throws Error if no address is provided and no current deposit recipient address is available in global state
 */
export async function checkCurrentDepositRecipientRegistration(
  namadaAddress?: string,
  channelId?: string
): Promise<NobleRegistrationStatus> {
  // Use provided address or get from global state
  const addressToCheck = namadaAddress || jotaiStore.get(depositRecipientAddressAtom)
  
  if (!addressToCheck) {
    throw new Error(
      'No deposit recipient address provided and no current deposit recipient address available in global state'
    )
  }

  console.debug('[NobleForwardingService] Checking registration for current deposit recipient', {
    namadaAddress: addressToCheck,
    source: namadaAddress ? 'provided' : 'global-state',
  })

  return checkNobleForwardingRegistration(addressToCheck, channelId)
}

