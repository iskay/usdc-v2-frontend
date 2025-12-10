import type { Sdk } from '@namada/sdk-multicore'
import type { NamadaKeychainAccount } from '@/services/wallet/namadaKeychain'
import type { ShieldedViewingKey } from '@/types/shielded'
import { getEffectiveIndexerUrl } from '@/services/config/customUrlResolver'
import { getDefaultNamadaChainKey } from '@/config/chains'
import { fetchTendermintChainsConfig } from '@/services/config/tendermintChainConfigService'

/**
 * Fetch block height by timestamp from the Namada indexer.
 * This is used to convert account creation timestamps to block heights for birthday optimization.
 */
export async function fetchBlockHeightByTimestamp(timestamp: number): Promise<number> {
  try {
    const tendermintConfig = await fetchTendermintChainsConfig()
    const namadaChainKey = getDefaultNamadaChainKey(tendermintConfig) || 'namada-testnet'
    const indexerUrl = await getEffectiveIndexerUrl(namadaChainKey)
    if (!indexerUrl) {
      throw new Error(`Indexer URL not found for chain: ${namadaChainKey}`)
    }

    // Convert timestamp to seconds (if it's in milliseconds)
    const timestampSeconds = timestamp > 1000000000000 ? Math.floor(timestamp / 1000) : timestamp

    const response = await fetch(`${indexerUrl}/api/v1/block/timestamp/${timestampSeconds}`)

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Block not found for timestamp')
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const data = (await response.json()) as { height?: number }
    const height = data?.height

    if (typeof height !== 'number' || height < 0) {
      throw new Error('Invalid height returned from indexer')
    }

    return height
  } catch (error) {
    console.warn('[MaspHelpers] Failed to fetch block height by timestamp:', error)
    throw error
  }
}

/**
 * Calculate the birthday (block height) for a given account.
 * For generated keys, converts the creation timestamp to block height.
 * For imported keys, returns 0 (full sync required).
 */
export async function calculateBirthday(account: NamadaKeychainAccount): Promise<number> {
  // For imported keys or accounts without timestamp, always sync from genesis
  if (account.source !== 'generated' || !account.timestamp) {
    return 0
  }

  try {
    const height = await fetchBlockHeightByTimestamp(account.timestamp)
    console.info(`[MaspHelpers] Account ${account.address?.slice(0, 12)}... birthday: block ${height}`)
    return height
  } catch (error) {
    console.warn(
      `[MaspHelpers] Failed to fetch block height for account ${account.address?.slice(0, 12)}..., falling back to height 0:`,
      error,
    )
    return 0
  }
}

/**
 * Normalize a NamadaKeychainAccount to a ShieldedViewingKey.
 * Extracts the viewing key and calculates the birthday.
 */
export async function normalizeViewingKey(
  account: NamadaKeychainAccount,
): Promise<ShieldedViewingKey> {
  if (!account.viewingKey) {
    throw new Error(`Account ${account.address} does not have a viewing key`)
  }

  const birthday = await calculateBirthday(account)

  return {
    key: account.viewingKey,
    birthday,
  }
}

/**
 * Normalize multiple accounts to viewing keys.
 */
export async function normalizeViewingKeys(
  accounts: NamadaKeychainAccount[],
): Promise<ShieldedViewingKey[]> {
  const results = await Promise.all(
    accounts.map((account) => {
      if (!account.viewingKey) {
        console.warn(`[MaspHelpers] Skipping account ${account.address} - no viewing key`)
        return null
      }
      return normalizeViewingKey(account).catch((error) => {
        console.warn(`[MaspHelpers] Failed to normalize viewing key for ${account.address}:`, error)
        return null
      })
    }),
  )

  return results.filter((vk): vk is ShieldedViewingKey => vk !== null)
}

export interface EnsureMaspReadyOptions {
  sdk: Sdk
  chainId: string
  paramsUrl?: string
}

/**
 * Ensure MASP parameters are ready for shielded operations.
 * Checks if params exist, fetches and stores if missing, then loads them.
 */
export async function ensureMaspReady({
  sdk,
  chainId,
  paramsUrl,
}: EnsureMaspReadyOptions): Promise<void> {
  const masp = sdk.masp
  const has = await masp.hasMaspParams()
  if (!has) {
    if (paramsUrl) {
      await masp.fetchAndStoreMaspParams(paramsUrl)
    } else {
      throw new Error('MASP params not available and paramsUrl not provided')
    }
  }
  await masp.loadMaspParams('', chainId)
}

/**
 * Check if MASP parameters are available.
 */
export async function hasMaspParams(sdk: Sdk): Promise<boolean> {
  return await sdk.masp.hasMaspParams()
}

/**
 * Clear the shielded context for a given chain.
 */
export async function clearShieldedContext(sdk: Sdk, chainId: string): Promise<void> {
  await sdk.masp.clearShieldedContext(chainId)
}

/**
 * Resolve viewing key from wallet state and accounts.
 * This is a shared helper used by both useShieldedSync and triggerShieldedBalanceRefresh.
 * Uses the currently selected account (from walletState.namada.account) to find the matching viewing key.
 * @param walletState - The wallet state from walletAtom
 * @returns Normalized viewing key or null if not found
 */
export async function resolveViewingKeyForSync(
  walletState: { namada: { isConnected: boolean; account?: string; viewingKey?: string } },
): Promise<ShieldedViewingKey | null> {
  if (!walletState.namada.isConnected) {
    return null
  }

  const { fetchNamadaAccounts } = await import('@/services/wallet/namadaKeychain')

  // Get all accounts from extension
  const accounts = await fetchNamadaAccounts()
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return null
  }

  let account: Awaited<ReturnType<typeof fetchNamadaAccounts>>[number] | undefined

  // Priority 1: Use the currently selected account (transparent address from wallet state)
  if (walletState.namada.account) {
    // Find the account matching the currently selected transparent address
    account = accounts.find((a) => a?.address === walletState.namada.account)
    
    // If the parent account doesn't have a viewing key, find its child shielded account
    // Note: id and parentId exist at runtime but aren't in the type definition
    const accountWithId = account as NamadaKeychainAccount & { id?: string }
    if (account && !account.viewingKey && accountWithId.id) {
      const shieldedChild = accounts.find(
        (a) => {
          const childWithParentId = a as NamadaKeychainAccount & { parentId?: string }
          return (
            childWithParentId?.parentId === accountWithId.id &&
            typeof a?.viewingKey === 'string' &&
            a.viewingKey.length > 0
          )
        },
      )
      if (shieldedChild) {
        account = shieldedChild
      }
    }
  }

  // Priority 2: If wallet state has a viewing key, try to match it to an account
  if (!account?.viewingKey && walletState.namada.viewingKey) {
    account = accounts.find(
      (a) => a?.viewingKey === walletState.namada.viewingKey,
    )
  }

  // Priority 3: Fallback to first account with viewing key (for backwards compatibility)
  if (!account?.viewingKey) {
    account = accounts.find((a) => typeof a?.viewingKey === 'string' && a.viewingKey.length > 0)
  }

  if (!account || !account.viewingKey) {
    return null
  }

  // Normalize viewing key (calculate birthday)
  return await normalizeViewingKey(account)
}

