import type { WalletConnection } from '@/types/wallet'
import {
  connectNamadaExtension,
  disconnectNamadaExtension,
  fetchDefaultNamadaAccount,
  fetchNamadaAccounts,
  isNamadaAvailable,
  type NamadaKeychainAccount,
} from '@/services/wallet/namadaKeychain'
import { emitWalletEvent } from '@/services/wallet/walletEvents'
import { NAMADA_CHAIN_ID } from '@/config/constants'

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
  emitWalletEvent('namada:disconnected', undefined)
  await disconnectNamadaExtension(NAMADA_CHAIN_ID).catch(() => undefined)
}

export async function disconnectWallets(): Promise<void> {
  await Promise.all([disconnectMetaMask(), disconnectNamada()])
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
