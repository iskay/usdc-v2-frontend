export interface NamadaKeychainAccount {
  address: string
  alias?: string
  publicKey?: string
  chainId?: string
  type?: string
  viewingKey?: string
  pseudoExtendedKey?: string
  source?: string
  timestamp?: number
  diversifierIndex?: number
}

export interface NamadaExtension {
  accounts(): Promise<readonly NamadaKeychainAccount[] | undefined>
  connect(chainId?: string): Promise<void>
  disconnect(chainId?: string): Promise<void>
  isConnected(chainId?: string): Promise<boolean | undefined>
  defaultAccount(): Promise<NamadaKeychainAccount | undefined>
  updateDefaultAccount(address: string): Promise<void>
  version(): string
}

async function resolveNamada(): Promise<NamadaExtension | undefined> {
  if (typeof window === 'undefined') return undefined
  if (window.namada) return window.namada
  if (document.readyState === 'complete') return window.namada
  return new Promise((resolve) => {
    const handler = (event: Event) => {
      if ((event.target as Document).readyState === 'complete') {
        resolve(window.namada)
        document.removeEventListener('readystatechange', handler)
      }
    }
    document.addEventListener('readystatechange', handler)
  })
}

export async function isNamadaAvailable(): Promise<boolean> {
  try {
    return Boolean(await resolveNamada())
  } catch {
    return false
  }
}

export async function connectNamadaExtension(chainId: string = 'namada'): Promise<NamadaExtension> {
  const namada = await resolveNamada()
  if (!namada) {
    throw new Error('Namada Keychain is not available. Please install the extension.')
  }
  await namada.connect(chainId)
  return namada
}

export async function disconnectNamadaExtension(chainId: string = 'namada'): Promise<void> {
  const namada = await resolveNamada()
  if (!namada) {
    throw new Error('Namada Keychain is not available')
  }
  // Let errors propagate so we can detect user disapproval
  // The extension rejects the promise if user clicks "Reject" in the approval popup
  await namada.disconnect(chainId)
}

export async function fetchNamadaAccounts(): Promise<readonly NamadaKeychainAccount[]> {
  const namada = await resolveNamada()
  if (!namada) return []
  try {
    return (await namada.accounts()) ?? []
  } catch {
    return []
  }
}

export async function fetchDefaultNamadaAccount(): Promise<NamadaKeychainAccount | undefined> {
  const namada = await resolveNamada()
  if (!namada) return undefined
  try {
    return (await namada.defaultAccount()) ?? undefined
  } catch {
    return undefined
  }
}

export async function checkNamadaConnection(chainId: string = 'namada'): Promise<boolean> {
  const namada = await resolveNamada()
  if (!namada) return false
  try {
    const connected = await namada.isConnected(chainId)
    return Boolean(connected)
  } catch {
    return false
  }
}

declare global {
  interface Window {
    namada?: NamadaExtension
  }
}

export type { NamadaExtension as NamadaKeychainExtension }

