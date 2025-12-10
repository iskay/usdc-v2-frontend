import { env } from '@/config/env'
import { getEffectiveIndexerUrl } from '@/services/config/customUrlResolver'
import { getDefaultNamadaChainKey } from '@/config/chains'
import { fetchTendermintChainsConfig } from '@/services/config/tendermintChainConfigService'

export interface NamadaBalance {
  tokenAddress: string
  minDenomAmount: string
}

export interface NamadaUSDCBalance {
  balance: string // minDenomAmount as string
  formattedBalance: string // Human-readable formatted balance
  tokenAddress: string
  accountAddress: string
}

/**
 * Get the Namada indexer API base URL from chain config.
 */
async function getNamadaIndexerUrl(): Promise<string> {
  const tendermintConfig = await fetchTendermintChainsConfig()
  const namadaChainKey = getDefaultNamadaChainKey(tendermintConfig) || 'namada-testnet'
  const indexerUrl = await getEffectiveIndexerUrl(namadaChainKey)
  if (!indexerUrl) {
    throw new Error(`Indexer URL not found for chain: ${namadaChainKey}`)
  }
  return indexerUrl
}

/**
 * Get the USDC token address from environment variable or return null.
 * This allows configuration via VITE_USDC_TOKEN_ADDRESS env var.
 */
export async function getUSDCAddressFromRegistry(): Promise<string | null> {
  try {
    const envAddress = env.usdcTokenAddress()
    if (envAddress && typeof envAddress === 'string' && envAddress.trim()) {
      return envAddress.trim()
    }
    // TODO: Add chain registry fallback if needed in the future
    return null
  } catch {
    return null
  }
}

/**
 * Fetch all account balances from the Namada indexer endpoint.
 * @param accountAddress - The Namada transparent address to query
 * @returns Array of balances with token addresses and minDenomAmount, or null on error
 */
export async function fetchNamadaAccountBalances(
  accountAddress: string
): Promise<NamadaBalance[] | null> {
  try {
    const indexerUrl = await getNamadaIndexerUrl()
    const apiUrl = `${indexerUrl}/api/v1/account/${accountAddress}`
    const response = await fetch(apiUrl)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const rawBalances = (await response.json()) as unknown[]

    // Handle multiple API response formats for robustness
    const balances: NamadaBalance[] = rawBalances.map((b: unknown) => {
      const balance = b as Record<string, unknown>
      
      // Extract tokenAddress with proper type handling
      let tokenAddress: string
      if (typeof balance.tokenAddress === 'string') {
        tokenAddress = balance.tokenAddress
      } else if (balance.tokenAddress && typeof balance.tokenAddress === 'object') {
        const tokenAddrObj = balance.tokenAddress as Record<string, unknown>
        tokenAddress = typeof tokenAddrObj.address === 'string' ? tokenAddrObj.address : ''
      } else if (balance.token && typeof balance.token === 'object') {
        const tokenObj = balance.token as Record<string, unknown>
        tokenAddress = typeof tokenObj.address === 'string' ? tokenObj.address : ''
      } else {
        tokenAddress = ''
      }
      
      return {
        tokenAddress,
        minDenomAmount: String(balance.minDenomAmount || '0'),
      }
    })

    return balances
  } catch (error) {
    console.error('[NamadaBalanceService] Failed to fetch account balances', {
      accountAddress,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * Get the USDC balance for a given Namada transparent address.
 * @param accountAddress - The Namada transparent address to query
 * @returns USDC balance information or null on error
 */
export async function getNamadaUSDCBalance(
  accountAddress: string
): Promise<NamadaUSDCBalance | null> {
  try {
    const balances = await fetchNamadaAccountBalances(accountAddress)
    if (!balances) {
      return null
    }

    const usdcAddress = await getUSDCAddressFromRegistry()
    if (!usdcAddress) {
      console.warn(
        '[NamadaBalanceService] USDC token address not configured. Set VITE_USDC_TOKEN_ADDRESS env var.'
      )
      return null
    }

    const usdcBalance = balances.find((b) => b.tokenAddress === usdcAddress)
    if (!usdcBalance) {
      // Return zero balance if USDC not found in balances
      return {
        balance: '0',
        formattedBalance: '0.000000',
        tokenAddress: usdcAddress,
        accountAddress,
      }
    }

    // USDC uses 6 decimals
    const decimals = 6
    const minDenom = BigInt(usdcBalance.minDenomAmount)
    const formattedRaw = Number(minDenom) / Math.pow(10, decimals)
    const formatted = (formattedRaw === 0 ? 0 : formattedRaw).toFixed(6)

    return {
      balance: usdcBalance.minDenomAmount,
      formattedBalance: formatted,
      tokenAddress: usdcAddress,
      accountAddress,
    }
  } catch (error) {
    console.error('[NamadaBalanceService] Failed to get USDC balance', {
      accountAddress,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

