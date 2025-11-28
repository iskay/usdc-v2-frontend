import type { WalletConnection } from '@/types/wallet'
import {
  connectNamadaExtension,
  disconnectNamadaExtension,
  fetchDefaultNamadaAccount,
  fetchNamadaAccounts,
  isNamadaAvailable,
  checkNamadaConnection,
  type NamadaKeychainAccount,
} from '@/services/wallet/namadaKeychain'
import { emitWalletEvent } from '@/services/wallet/walletEvents'
import { NAMADA_CHAIN_ID } from '@/config/constants'
import { jotaiStore } from '@/store/jotaiStore'
import { walletAtom, walletErrorAtom } from '@/atoms/walletAtom'
import { balanceAtom } from '@/atoms/balanceAtom'
import { requestBalanceRefresh } from '@/services/balance/balanceService'

interface EthereumProvider {
  isMetaMask?: boolean
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
  on?(event: string, handler: (...args: unknown[]) => void): void
  removeListener?(event: string, handler: (...args: unknown[]) => void): void
}

interface MetaMaskConnectOptions {
  chainIdHex?: string
}

interface NamadaConnectOptions {
  chainId?: string
}

let ethereumListenersRegistered = false
let namadaAccountChangeListenerRegistered = false

function resolveEthereumProvider(): EthereumProvider | undefined {
  if (typeof window === 'undefined') return undefined
  const provider = window.ethereum as EthereumProvider | undefined
  if (!provider || typeof provider.request !== 'function') {
    return undefined
  }
  return provider
}

export function isMetaMaskAvailable(): boolean {
  return Boolean(resolveEthereumProvider())
}

export async function connectMetaMask(options: MetaMaskConnectOptions = {}): Promise<WalletConnection> {
  const provider = resolveEthereumProvider()
  if (!provider) {
    throw new Error('MetaMask is not available in this browser. Please install the extension.')
  }

  registerEthereumEventBridge(provider)

  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[] | undefined
  if (!accounts || accounts.length === 0) {
    throw new Error('MetaMask did not return any accounts. Please ensure an account is unlocked.')
  }

  const { chainId, chainIdHex } = await ensureChain(provider, options.chainIdHex)

  emitWalletEvent('evm:accountsChanged', { accounts })
  // Note: evm:chainChanged will be emitted automatically by the provider event listener
  // We don't manually emit it here to avoid duplicate events

  return {
    evm: {
      address: accounts[0],
      chainId,
      chainIdHex,
    },
    connectedAt: Date.now(),
  }
}

export async function connectNamada(options: NamadaConnectOptions = {}): Promise<WalletConnection> {
  const available = await isNamadaAvailable()
  if (!available) {
    throw new Error('Namada Keychain is not available. Please install the browser extension.')
  }

  const chainId = options.chainId ?? NAMADA_CHAIN_ID
  await connectNamadaExtension(chainId)

  const accountInfo = await resolveNamadaAccount()
  if (!accountInfo) {
    throw new Error('No Namada accounts were returned by the Keychain extension.')
  }

  emitWalletEvent('namada:accountsChanged', {
    transparentAddress: accountInfo.transparentAddress,
    shieldedAddress: accountInfo.shieldedAddress,
    accountAlias: accountInfo.accountAlias,
    viewingKey: accountInfo.viewingKey,
  })

  return {
    namada: {
      transparentAddress: accountInfo.transparentAddress,
      shieldedAddress: accountInfo.shieldedAddress,
      accountAlias: accountInfo.accountAlias,
      viewingKey: accountInfo.viewingKey,
    },
    connectedAt: Date.now(),
  }
}

export async function disconnectMetaMask(): Promise<void> {
  emitWalletEvent('evm:disconnected', { error: undefined })
  // Attempt to revoke permissions if MetaMask supports it
  const provider = resolveEthereumProvider()
  if (provider) {
    try {
      await provider.request({
        method: 'wallet_revokePermissions',
        params: [{ eth_accounts: {} }],
      } as any)
    } catch {
      // Ignore if revoke is not supported
    }
  }
}

export async function disconnectNamada(): Promise<void> {
  // Only emit disconnected event if disconnect actually succeeds
  // If user disapproves, the extension will reject the promise
  await disconnectNamadaExtension(NAMADA_CHAIN_ID)
  emitWalletEvent('namada:disconnected', undefined)
}

export async function disconnectWallets(): Promise<void> {
  await Promise.all([disconnectMetaMask(), disconnectNamada()])
}

/**
 * Attempts to silently reconnect to MetaMask if already connected.
 * Uses eth_accounts (non-interactive) to check for existing connections.
 * Directly updates wallet atom and emits events to sync state without prompting the user.
 */
export async function attemptMetaMaskReconnection(): Promise<void> {
  const provider = resolveEthereumProvider()
  if (!provider) {
    return // MetaMask not available, silently skip
  }

  try {
    // Register event bridge first so we can listen to future changes
    registerEthereumEventBridge(provider)

    // Use eth_accounts (non-interactive) to check for existing connections
    const accounts = (await provider.request({ method: 'eth_accounts' })) as string[] | undefined

    if (!accounts || accounts.length === 0) {
      return // No existing connection, silently skip
    }

    // Get current chain info
    const chainIdHex = (await provider.request({ method: 'eth_chainId' })) as string
    const chainId = parseChainId(chainIdHex)

    // Directly update wallet atom (works even if React components haven't mounted yet)
    jotaiStore.set(walletAtom, (state) => ({
      ...state,
      metaMask: {
        ...state.metaMask,
        isConnecting: false,
        isConnected: true,
        account: accounts[0],
        chainId,
        chainHex: chainIdHex,
      },
      lastUpdated: Date.now(),
    }))
    jotaiStore.set(walletErrorAtom, undefined)

    // Also emit events for any listeners that are already registered
    emitWalletEvent('evm:accountsChanged', { accounts })
    emitWalletEvent('evm:chainChanged', { chainIdHex })

    console.info('[WalletService] MetaMask reconnected on startup', {
      account: accounts[0],
      chainId,
    })
  } catch (error) {
    // Silently fail - don't block app initialization
    console.warn('[WalletService] Failed to reconnect MetaMask on startup', error)
  }
}

/**
 * Attempts to silently reconnect to Namada extension if already connected.
 * Uses isConnected() to check connection status without prompting.
 * Directly updates wallet atom and emits events to sync state if connected.
 */
export async function attemptNamadaReconnection(): Promise<void> {
  try {
    const available = await isNamadaAvailable()
    if (!available) {
      return // Namada not available, silently skip
    }

    // Check if already connected (non-interactive check)
    const connected = await checkNamadaConnection(NAMADA_CHAIN_ID)
    if (!connected) {
      return // Not connected, silently skip
    }

    // Fetch account info
    const accountInfo = await resolveNamadaAccount()
    if (!accountInfo) {
      return // No account info available
    }

    // Directly update wallet atom (works even if React components haven't mounted yet)
    jotaiStore.set(walletAtom, (state) => ({
      ...state,
      namada: {
        ...state.namada,
        isConnecting: false,
        isConnected: true,
        account: accountInfo.transparentAddress,
        shieldedAccount: accountInfo.shieldedAddress,
        alias: accountInfo.accountAlias,
        viewingKey: accountInfo.viewingKey,
      },
      lastUpdated: Date.now(),
    }))
    jotaiStore.set(walletErrorAtom, undefined)

    // Also emit events for any listeners that are already registered
    emitWalletEvent('namada:accountsChanged', {
      transparentAddress: accountInfo.transparentAddress,
      shieldedAddress: accountInfo.shieldedAddress,
      accountAlias: accountInfo.accountAlias,
      viewingKey: accountInfo.viewingKey,
    })

    // Trigger immediate balance refresh when transparent address becomes available
    // This matches the behavior of manual connection via button click
    if (accountInfo.transparentAddress) {
      void requestBalanceRefresh({ trigger: 'manual' })
    }

    console.info('[WalletService] Namada reconnected on startup', {
      account: accountInfo.transparentAddress,
    })
  } catch (error) {
    // Silently fail - don't block app initialization
    console.warn('[WalletService] Failed to reconnect Namada on startup', error)
  }
}

async function ensureChain(provider: EthereumProvider, desiredChainIdHex?: string): Promise<{ chainId: number | undefined; chainIdHex: string }>
{
  const currentChainIdHex = (await provider.request({ method: 'eth_chainId' })) as string
  if (!desiredChainIdHex || desiredChainIdHex.toLowerCase() === currentChainIdHex.toLowerCase()) {
    return {
      chainId: parseChainId(currentChainIdHex),
      chainIdHex: currentChainIdHex,
    }
  }

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: desiredChainIdHex }],
    })
  } catch (error) {
    console.warn('Failed to switch MetaMask chain', error)
  }

  const updatedChainIdHex = (await provider.request({ method: 'eth_chainId' })) as string
  return {
    chainId: parseChainId(updatedChainIdHex),
    chainIdHex: updatedChainIdHex,
  }
}

function parseChainId(chainIdHex: string | number | undefined): number | undefined {
  if (typeof chainIdHex === 'number') return chainIdHex
  if (typeof chainIdHex !== 'string') return undefined
  const normalized = chainIdHex.startsWith('0x') ? chainIdHex : `0x${chainIdHex}`
  const parsed = Number.parseInt(normalized, 16)
  return Number.isNaN(parsed) ? undefined : parsed
}

function registerEthereumEventBridge(provider: EthereumProvider): void {
  if (ethereumListenersRegistered) return

  provider.on?.('accountsChanged', (...args: unknown[]) => {
    const accounts = args[0] as string[]
    emitWalletEvent('evm:accountsChanged', { accounts })
  })

  provider.on?.('chainChanged', (...args: unknown[]) => {
    const chainIdHex = args[0] as string
    emitWalletEvent('evm:chainChanged', { chainIdHex })
  })

  provider.on?.('disconnect', (...args: unknown[]) => {
    const error = args[0] as unknown
    emitWalletEvent('evm:disconnected', { error })
  })

  ethereumListenersRegistered = true
}

/**
 * Registers a window event listener for Namada account changes.
 * This listener stays active for the lifetime of the app and automatically
 * updates wallet state when the user switches accounts in the extension.
 * 
 * The listener:
 * - Checks connection status before processing (safe even when disconnected)
 * - Updates wallet atom directly
 * - Emits namada:accountsChanged event (triggers existing handlers)
 * - Triggers balance refresh
 * - Includes debug logging
 * 
 * Note: The extension only dispatches events to approved origins, so we
 * won't receive events when disconnected. The listener check is an extra safety guard.
 */
export function registerNamadaAccountChangeListener(): void {
  if (namadaAccountChangeListenerRegistered) return
  if (typeof window === 'undefined') return

  window.addEventListener('namada-account-changed', async () => {
    console.info('[WalletService] Namada account changed event received')
    
    try {
      // Check if still connected (safety guard - extension won't send events when disconnected anyway)
      const connected = await checkNamadaConnection(NAMADA_CHAIN_ID)
      if (!connected) {
        console.debug('[WalletService] Account changed event received but extension not connected, ignoring')
        return
      }

      // Fetch new account info
      const accountInfo = await resolveNamadaAccount()
      if (!accountInfo) {
        console.warn('[WalletService] Account changed but could not fetch account info')
        return
      }

      const currentState = jotaiStore.get(walletAtom)
      const previousAccount = currentState.namada.account
      const isAccountChange = previousAccount && previousAccount !== accountInfo.transparentAddress

      console.info('[WalletService] Namada account changed', {
        previous: previousAccount,
        new: accountInfo.transparentAddress,
        isAccountChange,
        alias: accountInfo.accountAlias,
      })

      // Clear Namada balances if account changed (will show '--' while fetching new balances)
      if (isAccountChange) {
        console.info('[WalletService] Clearing Namada balances for account switch')
        jotaiStore.set(balanceAtom, (state) => ({
          ...state,
          namada: {
            usdcShielded: '--',
            usdcTransparent: '--',
            shieldedLastUpdated: undefined,
            transparentLastUpdated: undefined,
          },
        }))
      }

      // Emit event (handler will update wallet atom - this ensures handler can read previous account from state)
      emitWalletEvent('namada:accountsChanged', {
        transparentAddress: accountInfo.transparentAddress,
        shieldedAddress: accountInfo.shieldedAddress,
        accountAlias: accountInfo.accountAlias,
        viewingKey: accountInfo.viewingKey,
      })
      
      // Also update wallet atom directly for consistency (in case handler hasn't registered yet)
      // This is safe because the handler reads previousAccount before updating
      jotaiStore.set(walletAtom, (state) => ({
        ...state,
        namada: {
          ...state.namada,
          isConnecting: false,
          isConnected: true,
          account: accountInfo.transparentAddress,
          shieldedAccount: accountInfo.shieldedAddress,
          alias: accountInfo.accountAlias,
          viewingKey: accountInfo.viewingKey,
        },
        lastUpdated: Date.now(),
      }))
      jotaiStore.set(walletErrorAtom, undefined)

      // Trigger balance refresh
      if (accountInfo.transparentAddress) {
        void requestBalanceRefresh({ trigger: 'manual' })
      }
    } catch (error) {
      console.error('[WalletService] Failed to handle Namada account change', error)
    }
  })

  namadaAccountChangeListenerRegistered = true
  console.debug('[WalletService] Namada account change listener registered')
}

interface NamadaResolvedAccount {
  transparentAddress: string
  shieldedAddress?: string
  accountAlias?: string
  viewingKey?: string
}

async function resolveNamadaAccount(): Promise<NamadaResolvedAccount | undefined> {
  const defaultAccount = await fetchDefaultNamadaAccount()
  const accounts = await fetchNamadaAccounts()

  const candidate: NamadaKeychainAccount | undefined = defaultAccount ?? accounts[0]
  if (!candidate) return undefined

  // Find the child account with payment address starting with 'z' (for shielding transactions)
  // This is different from pseudoExtendedKey which is used for gas spending
  let shieldedPaymentAddress: string | undefined
  try {
    const allAccounts = Array.isArray(accounts) ? accounts : []
    const parent = allAccounts.find((a) => a?.address === candidate.address)
    if (parent?.id) {
      const child = allAccounts.find(
        (a) =>
          a?.parentId === parent.id &&
          typeof a?.address === 'string' &&
          String(a?.type || '').toLowerCase().includes('shielded'),
      )
      if (child?.address && String(child.address).startsWith('z')) {
        shieldedPaymentAddress = child.address
      }
    }
  } catch (error) {
    console.warn('[WalletService] Failed to find shielded payment address:', error)
  }

  return {
    transparentAddress: candidate.address,
    shieldedAddress: shieldedPaymentAddress, // Payment address starting with 'z'
    accountAlias: candidate.alias,
    viewingKey: candidate.viewingKey, // Keep viewingKey for sync/balance
  }
}

declare global {
  interface Window {
    ethereum?: EthereumProvider
  }
}

export { isNamadaAvailable } from '@/services/wallet/namadaKeychain'
