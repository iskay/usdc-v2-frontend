/**
 * Noble forwarding service for fetching Noble forwarding addresses
 * for Namada destination addresses via the Noble LCD endpoint.
 */

import { env } from '@/config/env'
import { jotaiStore } from '@/store/jotaiStore'
import { depositRecipientAddressAtom } from '@/atoms/appAtom'
import { getTendermintLcdUrl } from '@/services/polling/tendermintRpcClient'

export interface NobleForwardingResponse {
  address: string
  exists?: boolean
}

export interface NobleRegistrationStatus {
  exists: boolean
  address?: string
  error?: string // Error message if registration status could not be determined
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
  // Get LCD URL from config (with env fallback for backward compatibility)
  let lcdUrl: string
  try {
    lcdUrl = await getTendermintLcdUrl('noble-testnet')
  } catch (error) {
    // Fallback to env variable
    lcdUrl = env.nobleLcdUrl() || ''
    if (!lcdUrl) {
      throw new Error(
        'Noble LCD URL not configured. Please set lcdUrl in tendermint-chains.json or VITE_NOBLE_LCD_URL environment variable.'
      )
    }
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
  // Get LCD URL from config (with env fallback for backward compatibility)
  let lcdUrl: string | undefined
  try {
    lcdUrl = await getTendermintLcdUrl('noble-testnet')
  } catch (error) {
    // Fallback to env variable
    lcdUrl = env.nobleLcdUrl()
  }
  
  if (!lcdUrl) {
    // If LCD URL is not configured, return error instead of assuming
    console.warn('[NobleForwardingService] LCD URL not configured')
    return { 
      exists: false,
      error: 'Noble LCD URL not configured. Cannot determine registration status.'
    }
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
      // 404 might mean not registered, but other errors are actual problems
      if (response.status === 404) {
        console.debug('[NobleForwardingService] LCD returned 404, address not registered', {
          status: response.status,
          statusText: response.statusText,
        })
        return { exists: false }
      }
      
      // For other HTTP errors, return error status
      const errorText = await response.text().catch(() => response.statusText)
      console.error('[NobleForwardingService] LCD response error', {
        status: response.status,
        statusText: response.statusText,
        errorText,
      })
      return {
        exists: false,
        error: `Failed to check registration status: ${response.status} ${response.statusText}`
      }
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
    // Network errors (ERR_NAME_NOT_RESOLVED, ERR_CONNECTION_REFUSED, etc.) should return error
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('[NobleForwardingService] Failed to check Noble forwarding registration', {
      namadaAddress,
      channel,
      error: errorMessage,
    })
    
    // Check if it's a network error
    const isNetworkError = 
      errorMessage.includes('ERR_NAME_NOT_RESOLVED') ||
      errorMessage.includes('ERR_CONNECTION_REFUSED') ||
      errorMessage.includes('ERR_NETWORK') ||
      errorMessage.includes('Failed to fetch') ||
      errorMessage.includes('NetworkError') ||
      errorMessage.includes('network')
    
    if (isNetworkError) {
      return {
        exists: false,
        error: 'Network error: Could not connect to Noble LCD endpoint'
      }
    }
    
    // For other errors, still return error status
    return {
      exists: false,
      error: `Failed to check registration status: ${errorMessage}`
    }
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

