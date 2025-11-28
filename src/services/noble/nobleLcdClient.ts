/**
 * Noble LCD API Client
 * 
 * Low-level client for interacting with Noble LCD API endpoints.
 * Provides methods for checking forwarding registration status, balance queries, and transaction broadcasting.
 * 
 * Note: Transaction broadcasting uses RPC endpoint (broadcast_tx_sync) to avoid CORS issues with LCD POST requests.
 */

import { logger } from '@/utils/logger'
import { env } from '@/config/env'
import { retryWithBackoff } from '@/services/polling/basePoller'
import { createTendermintRpcClient, getTendermintRpcUrl } from '@/services/polling/tendermintRpcClient'

/**
 * Response from Noble forwarding address check endpoint
 */
export interface NobleForwardingAddressResponse {
  exists: boolean
  address?: string
}

/**
 * Response from Noble balance query endpoint
 */
export interface NobleBalanceResponse {
  balances: Array<{
    denom: string
    amount: string
  }>
}

/**
 * Response from Noble transaction broadcast endpoint
 */
export interface NobleBroadcastResponse {
  tx_response: {
    code: number
    txhash: string
    raw_log?: string
  }
}

/**
 * Noble LCD Client
 */
class NobleLcdClient {
  private baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '') // Remove trailing slash
  }

  /**
   * Check if a Noble forwarding address exists (is registered)
   * 
   * @param channel - IBC channel ID (e.g., 'channel-136')
   * @param recipient - Namada recipient address
   * @param fallback - Optional fallback address
   * @param abortSignal - Optional abort signal for cancellation
   * @returns Response with exists flag and address (if exists)
   */
  async checkForwardingAddressExists(
    channel: string,
    recipient: string,
    fallback: string = '',
    abortSignal?: AbortSignal,
  ): Promise<NobleForwardingAddressResponse> {
    const url = fallback
      ? `${this.baseUrl}/noble/forwarding/v1/address/${channel}/${recipient}/${fallback}`
      : `${this.baseUrl}/noble/forwarding/v1/address/${channel}/${recipient}/` // Trailing slash is essential

    logger.debug('[NobleLcdClient] Checking forwarding address existence', {
      channel,
      recipient,
      fallback,
      url,
    })

    try {
      const response = await retryWithBackoff(
        async () => {
          // For GET requests, don't include Content-Type header (triggers CORS preflight unnecessarily)
          // Only include Accept header to indicate we want JSON response
          const res = await fetch(url, {
            headers: {
              Accept: 'application/json',
            },
            signal: abortSignal,
          })

          if (!res.ok) {
            // 404 means forwarding address doesn't exist
            if (res.status === 404) {
              logger.debug('[NobleLcdClient] Forwarding address does not exist (404)', {
                channel,
                recipient,
              })
              return { ok: false, status: 404 }
            }
            throw new Error(`LCD API returned ${res.status}: ${res.statusText}`)
          }

          const data = await res.json()
          return { ok: true, data }
        },
        3, // max retries
        500, // initial delay
        5000, // max delay
        abortSignal,
      )

      if (!response.ok) {
        // 404 means not registered
        return { exists: false }
      }

      const data = response.data as NobleForwardingAddressResponse
      return {
        exists: Boolean(data?.exists),
        address: data?.address,
      }
    } catch (error) {
      // On error, assume not registered (conservative approach)
      logger.warn('[NobleLcdClient] Failed to check forwarding address existence, assuming not registered', {
        channel,
        recipient,
        fallback,
        error: error instanceof Error ? error.message : String(error),
      })
      return { exists: false }
    }
  }

  /**
   * Get balance for a Noble address
   * 
   * @param address - Noble address (bech32 format)
   * @param abortSignal - Optional abort signal for cancellation
   * @returns Balance response with uusdc balance
   */
  async getBalance(
    address: string,
    abortSignal?: AbortSignal,
  ): Promise<NobleBalanceResponse> {
    const url = `${this.baseUrl}/cosmos/bank/v1beta1/balances/${address}`

    logger.debug('[NobleLcdClient] Fetching Noble balance', {
      address,
      url,
    })

    try {
      const response = await retryWithBackoff(
        async () => {
          // For GET requests, don't include Content-Type header (triggers CORS preflight unnecessarily)
          // Only include Accept header to indicate we want JSON response
          const res = await fetch(url, {
            headers: {
              Accept: 'application/json',
            },
            signal: abortSignal,
          })

          if (!res.ok) {
            throw new Error(`LCD API returned ${res.status}: ${res.statusText}`)
          }

          return res.json()
        },
        3, // max retries
        500, // initial delay
        5000, // max delay
        abortSignal,
      )

      return response as NobleBalanceResponse
    } catch (error) {
      logger.error('[NobleLcdClient] Failed to fetch Noble balance', {
        address,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  /**
   * Broadcast a transaction to Noble chain
   * Uses RPC endpoint (broadcast_tx_sync) instead of LCD to avoid CORS issues
   * 
   * @param txBytes - Base64-encoded transaction bytes
   * @param abortSignal - Optional abort signal for cancellation
   * @returns Broadcast response with tx hash and status
   */
  async broadcastTransaction(
    txBytes: string,
    abortSignal?: AbortSignal,
  ): Promise<NobleBroadcastResponse> {
    logger.debug('[NobleLcdClient] Broadcasting Noble transaction via RPC', {
      txBytesLength: txBytes.length,
    })

    try {
      // Use RPC endpoint instead of LCD to avoid CORS issues
      // RPC uses JSON-RPC which may have better CORS support
      const chainKey = 'noble-testnet' // Default to testnet, could be made configurable
      const rpcUrl = await getTendermintRpcUrl(chainKey)
      const rpcClient = createTendermintRpcClient(rpcUrl)
      
      const response = await retryWithBackoff(
        async () => {
          const result = await rpcClient.broadcastTxSync(txBytes, abortSignal)
          
          // Convert RPC response format to LCD response format for compatibility
          return {
            tx_response: {
              txhash: result.hash,
              code: result.code || 0,
              data: result.data || '',
              log: result.log || '',
              codespace: result.codespace || '',
            },
          } as NobleBroadcastResponse
        },
        3, // max retries
        500, // initial delay
        5000, // max delay
        abortSignal,
      )

      logger.info('[NobleLcdClient] Successfully broadcast transaction via RPC', {
        txHash: response.tx_response.txhash,
        code: response.tx_response.code,
      })

      return response
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      
      logger.error('[NobleLcdClient] Failed to broadcast Noble transaction via RPC', {
        error: errorMessage,
        note: 'Falling back to LCD endpoint if RPC fails',
      })
      
      // Fallback to LCD endpoint if RPC fails
      // This maintains backward compatibility
      try {
        return await this.broadcastTransactionViaLcd(txBytes, abortSignal)
      } catch (lcdError) {
        logger.error('[NobleLcdClient] Both RPC and LCD broadcast failed', {
          rpcError: errorMessage,
          lcdError: lcdError instanceof Error ? lcdError.message : String(lcdError),
        })
        throw error // Throw original RPC error
      }
    }
  }

  /**
   * Broadcast a transaction via LCD endpoint (fallback method)
   * 
   * @param txBytes - Base64-encoded transaction bytes
   * @param abortSignal - Optional abort signal for cancellation
   * @returns Broadcast response with tx hash and status
   * @private
   */
  private async broadcastTransactionViaLcd(
    txBytes: string,
    abortSignal?: AbortSignal,
  ): Promise<NobleBroadcastResponse> {
    const url = `${this.baseUrl}/cosmos/tx/v1beta1/txs`

    logger.debug('[NobleLcdClient] Broadcasting Noble transaction via LCD', {
      url,
      txBytesLength: txBytes.length,
    })

    const response = await retryWithBackoff(
      async () => {
        // POST requests with JSON body require Content-Type header
        // This triggers CORS preflight (OPTIONS request)
        // If preflight fails, it's a server-side CORS configuration issue
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            tx_bytes: txBytes,
            mode: 'BROADCAST_MODE_SYNC',
          }),
          signal: abortSignal,
        })

        if (!res.ok) {
          const errorText = await res.text()
          throw new Error(`LCD API returned ${res.status}: ${res.statusText} - ${errorText}`)
        }

        return res.json()
      },
      3, // max retries
      500, // initial delay
      5000, // max delay
      abortSignal,
    )

    return response as NobleBroadcastResponse
  }
}

/**
 * Create Noble LCD client instance
 * 
 * @param baseUrl - Optional base URL (defaults to env config)
 * @returns Noble LCD client instance
 */
export function createNobleLcdClient(baseUrl?: string): NobleLcdClient {
  const url = baseUrl || env.nobleLcdUrl()
  if (!url) {
    throw new Error('Noble LCD URL not configured. Please set VITE_NOBLE_LCD_URL environment variable.')
  }
  return new NobleLcdClient(url)
}

/**
 * Get uusdc balance for a Noble address
 * 
 * @param address - Noble address
 * @param abortSignal - Optional abort signal for cancellation
 * @returns Balance in uusdc (BigInt), or 0n if not found
 */
export async function getNobleUusdcBalance(
  address: string,
  abortSignal?: AbortSignal,
): Promise<bigint> {
  const client = createNobleLcdClient()
  const balanceResponse = await client.getBalance(address, abortSignal)
  
  const uusdcBalance = balanceResponse.balances.find((b) => b.denom === 'uusdc')
  return uusdcBalance ? BigInt(uusdcBalance.amount) : 0n
}

