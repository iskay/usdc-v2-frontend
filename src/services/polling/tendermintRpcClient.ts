/**
 * Tendermint RPC Client
 * 
 * Provides interface for making Tendermint RPC calls (tx_search, getBlockResults, etc.)
 * Used by Noble and Namada pollers.
 */

import { logger } from '@/utils/logger'
import { retryWithBackoff } from './basePoller'

/**
 * Tendermint transaction structure
 */
export interface TendermintTx {
  hash: string
  height: string
  tx_result?: {
    events?: Array<{
      type: string
      attributes?: Array<{ key: string; value: string; index?: boolean }>
    }>
  }
  result?: {
    events?: Array<{
      type: string
      attributes?: Array<{ key: string; value: string; index?: boolean }>
    }>
  }
}

/**
 * Tendermint block results structure
 */
export interface TendermintBlockResults {
  height: string
  finalize_block_events?: Array<{
    type: string
    attributes?: Array<{ key: string; value: string; index?: boolean }>
  }>
  end_block_events?: Array<{
    type: string
    attributes?: Array<{ key: string; value: string; index?: boolean }>
  }>
}

/**
 * Tendermint RPC Client interface
 */
export interface TendermintRpcClient {
  /**
   * Search for transactions by query
   * 
   * @param query - Search query (e.g., "circle.cctp.v1.MessageReceived.nonce='\"123\"'")
   * @param page - Page number (default: 1)
   * @param perPage - Results per page (default: 30)
   * @param abortSignal - Optional abort signal
   * @returns Array of matching transactions
   */
  searchTransactions(
    query: string,
    page?: number,
    perPage?: number,
    abortSignal?: AbortSignal,
  ): Promise<TendermintTx[]>

  /**
   * Get block results for a specific height
   * 
   * @param height - Block height
   * @returns Block results or null if not found
   */
  getBlockResults(height: number): Promise<TendermintBlockResults | null>

  /**
   * Get latest block height
   * 
   * @returns Latest block height
   */
  getLatestBlockHeight(): Promise<number>
}

/**
 * Create Tendermint RPC client
 * 
 * @param rpcUrl - RPC endpoint URL
 * @returns Tendermint RPC client instance
 */
export function createTendermintRpcClient(rpcUrl: string): TendermintRpcClient {
  /**
   * Make JSON-RPC request
   */
  async function callRpc<T>(
    method: string,
    params: Record<string, unknown> = {},
    abortSignal?: AbortSignal,
  ): Promise<T> {
    const payload = {
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params,
    }

    // Check abort signal before making request
    if (abortSignal?.aborted) {
      throw new Error('Polling cancelled')
    }

    let response: Response
    try {
      response = await fetch(rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: abortSignal,
      })
    } catch (fetchError) {
      // Handle AbortError from fetch
      if (fetchError instanceof Error && (fetchError.name === 'AbortError' || abortSignal?.aborted)) {
        throw new Error('Polling cancelled')
      }
      throw fetchError
    }

    // Check abort signal after fetch (in case it was aborted during the request)
    if (abortSignal?.aborted) {
      throw new Error('Polling cancelled')
    }

    if (!response.ok) {
      throw new Error(`Tendermint RPC error: ${response.status} ${response.statusText}`)
    }

    let data: any
    try {
      data = await response.json()
    } catch (parseError) {
      // If abort happened during JSON parsing, check signal
      if (abortSignal?.aborted) {
        throw new Error('Polling cancelled')
      }
      throw parseError
    }

    // Check abort signal after parsing response
    if (abortSignal?.aborted) {
      throw new Error('Polling cancelled')
    }

    if (data.error) {
      throw new Error(
        `Tendermint RPC error (${data.error.code}): ${data.error.message}`,
      )
    }

    return data.result as T
  }

  return {
    async searchTransactions(
      query: string,
      page: number = 1,
      perPage: number = 30,
      abortSignal?: AbortSignal,
    ): Promise<TendermintTx[]> {
      // Format query: wrap entire query string in double quotes (matching backend exactly)
      // Example input query: circle.cctp.v1.MessageReceived.nonce='\"704111\"'
      // Example formatted: "circle.cctp.v1.MessageReceived.nonce='\"704111\"'"
      const formattedQuery = `"${query}"`
      
      // Manually construct the URL-encoded query parameter (matching backend exactly)
      // Format: "circle.cctp.v1.MessageReceived.nonce%3D%27\"704111\"%27"
      // - Outer quotes are literal (encoded for HTTP)
      // - = is encoded as %3D
      // - ' is encoded as %27
      // - \" stays as \" (backslash + quote, not encoded)
      // Strategy: encode everything, then replace encoded backslashes with literal backslashes
      let queryParam = encodeURIComponent(formattedQuery)
      // Replace %5C (encoded backslash) with literal backslash
      queryParam = queryParam.replace(/%5C/g, '\\')
      
      // Build URL with query parameter only (page/per_page/order_by removed as they cause query to fail)
      const url = `/tx_search?query=${queryParam}`
      
      // Construct full URL
      const baseURL = rpcUrl.endsWith('/') ? rpcUrl.slice(0, -1) : rpcUrl
      const fullUrl = `${baseURL}${url}`
      
      logger.debug('[TendermintRpcClient] tx_search request (GET)', {
        rawQuery: query,
        formattedQuery,
        queryParam,
        fullUrl,
        page,
        perPage,
      })

      try {
        // Check abort signal before making request
        if (abortSignal?.aborted) {
          throw new Error('Polling cancelled')
        }

        let response: Response
        try {
          response = await fetch(fullUrl, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
            signal: abortSignal,
          })
        } catch (fetchError) {
          // Handle AbortError from fetch
          if (fetchError instanceof Error && (fetchError.name === 'AbortError' || abortSignal?.aborted)) {
            throw new Error('Polling cancelled')
          }
          throw fetchError
        }

        // Check abort signal after fetch
        if (abortSignal?.aborted) {
          throw new Error('Polling cancelled')
        }

        if (!response.ok) {
          throw new Error(`Tendermint RPC error: ${response.status} ${response.statusText}`)
        }

        let data: any
        try {
          data = await response.json()
        } catch (parseError) {
          if (abortSignal?.aborted) {
            throw new Error('Polling cancelled')
          }
          throw parseError
        }

        // Check abort signal after parsing response
        if (abortSignal?.aborted) {
          throw new Error('Polling cancelled')
        }

        if (data.error) {
          throw new Error(
            `Tendermint RPC error (${data.error.code}): ${data.error.message}`,
          )
        }

        // Handle different response structures (matching backend)
        const txs = data?.txs || data?.result?.txs || []
        
        logger.debug('[TendermintRpcClient] tx_search result', {
          query,
          txCount: txs.length,
          totalCount: data?.total_count || data?.result?.total_count,
        })
        
        return txs
      } catch (error) {
        logger.warn('[TendermintRpcClient] tx_search failed', {
          query,
          error: error instanceof Error ? error.message : String(error),
        })
        throw error
      }
    },

    async getBlockResults(height: number, abortSignal?: AbortSignal): Promise<TendermintBlockResults | null> {
      try {
        const result = await retryWithBackoff(
          () => callRpc<TendermintBlockResults>('block_results', { height: height.toString() }, abortSignal),
          3,
          500,
          5000,
          abortSignal,
        )
        return result
      } catch (error) {
        logger.warn('[TendermintRpcClient] getBlockResults failed', {
          height,
          error: error instanceof Error ? error.message : String(error),
        })
        return null
      }
    },

    async getLatestBlockHeight(abortSignal?: AbortSignal): Promise<number> {
      try {
        const status = await retryWithBackoff(
          () => callRpc<{ sync_info?: { latest_block_height?: string } }>('status', {}, abortSignal),
          3,
          500,
          5000,
          abortSignal,
        )
        const height = status?.sync_info?.latest_block_height
        if (!height) {
          throw new Error('Latest block height not found in status response')
        }
        return Number.parseInt(height, 10)
      } catch (error) {
        logger.warn('[TendermintRpcClient] getLatestBlockHeight failed', {
          error: error instanceof Error ? error.message : String(error),
        })
        throw error
      }
    },
  }
}

/**
 * Get Tendermint RPC URL for a chain
 * 
 * @param chainKey - Chain key (e.g., 'noble-testnet', 'namada-testnet')
 * @returns RPC URL
 */
export async function getTendermintRpcUrl(chainKey: string): Promise<string> {
  const { fetchTendermintChainsConfig } = await import('@/services/config/tendermintChainConfigService')
  const config = await fetchTendermintChainsConfig()
  const chain = config.chains.find((c) => c.key === chainKey)

  if (!chain || !chain.rpcUrls[0]) {
    throw new Error(`RPC URL not found for Tendermint chain: ${chainKey}`)
  }

  return chain.rpcUrls[0]
}

