import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Sdk } from '@namada/sdk-multicore'
import type { NamadaKeychainAccount } from '@/services/wallet/namadaKeychain'
import {
  calculateBirthday,
  normalizeViewingKey,
  normalizeViewingKeys,
  ensureMaspReady,
  hasMaspParams,
  clearShieldedContext,
  fetchBlockHeightByTimestamp,
} from '../maspHelpers'
import { env } from '@/config/env'

// Mock the env module
vi.mock('@/config/env', () => ({
  env: {
    namadaIndexerUrl: vi.fn(() => 'https://indexer.testnet.siuuu.click'),
  },
}))

describe('fetchBlockHeightByTimestamp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(env.namadaIndexerUrl).mockReturnValue('https://indexer.testnet.siuuu.click')
  })

  it('fetches block height for a timestamp in seconds', async () => {
    const mockResponse = { height: 12345 }
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    })

    const height = await fetchBlockHeightByTimestamp(1700000000)
    expect(height).toBe(12345)
    expect(global.fetch).toHaveBeenCalledWith(
      'https://indexer.testnet.siuuu.click/block/height/by_timestamp/1700000000',
    )
  })

  it('converts milliseconds to seconds', async () => {
    const mockResponse = { height: 12345 }
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    })

    const height = await fetchBlockHeightByTimestamp(1700000000000)
    expect(height).toBe(12345)
    expect(global.fetch).toHaveBeenCalledWith(
      'https://indexer.testnet.siuuu.click/block/height/by_timestamp/1700000000',
    )
  })

  it('throws when indexer URL is not configured', async () => {
    // Mock to return undefined for testing error case
    vi.mocked(env.namadaIndexerUrl).mockReturnValue(undefined as unknown as string)

    await expect(fetchBlockHeightByTimestamp(1700000000)).rejects.toThrow(
      'Indexer URL not configured',
    )
  })

  it('throws when response is not ok', async () => {
    vi.mocked(env.namadaIndexerUrl).mockReturnValue('https://indexer.testnet.siuuu.click')
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    })

    await expect(fetchBlockHeightByTimestamp(1700000000)).rejects.toThrow('Block not found for timestamp')
  })

  it('throws when height is invalid', async () => {
    vi.mocked(env.namadaIndexerUrl).mockReturnValue('https://indexer.testnet.siuuu.click')
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ height: -1 }),
    })

    await expect(fetchBlockHeightByTimestamp(1700000000)).rejects.toThrow(
      'Invalid height returned from indexer',
    )
  })
})

describe('calculateBirthday', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(env.namadaIndexerUrl).mockReturnValue('https://indexer.testnet.siuuu.click')
  })

  it('returns 0 for imported accounts', async () => {
    const account: NamadaKeychainAccount = {
      address: 'tnam1q9gr66cvu4hrzm0sd5kmlnjje82gs3xlfg3v6nu7',
      source: 'imported',
    }

    const birthday = await calculateBirthday(account)
    expect(birthday).toBe(0)
  })

  it('returns 0 for accounts without timestamp', async () => {
    const account: NamadaKeychainAccount = {
      address: 'tnam1q9gr66cvu4hrzm0sd5kmlnjje82gs3xlfg3v6nu7',
      source: 'generated',
    }

    const birthday = await calculateBirthday(account)
    expect(birthday).toBe(0)
  })

  it('calculates birthday from timestamp for generated accounts', async () => {
    const mockResponse = { height: 5000 }
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    })

    const account: NamadaKeychainAccount = {
      address: 'tnam1q9gr66cvu4hrzm0sd5kmlnjje82gs3xlfg3v6nu7',
      source: 'generated',
      timestamp: 1700000000000,
    }

    const birthday = await calculateBirthday(account)
    expect(birthday).toBe(5000)
  })

  it('falls back to 0 when indexer lookup fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    })

    const account: NamadaKeychainAccount = {
      address: 'tnam1q9gr66cvu4hrzm0sd5kmlnjje82gs3xlfg3v6nu7',
      source: 'generated',
      timestamp: 1700000000000,
    }

    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const birthday = await calculateBirthday(account)
    expect(birthday).toBe(0)
    expect(consoleWarnSpy).toHaveBeenCalled()
    consoleWarnSpy.mockRestore()
  })
})

describe('normalizeViewingKey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(env.namadaIndexerUrl).mockReturnValue('https://indexer.testnet.siuuu.click')
  })

  it('normalizes a viewing key with birthday', async () => {
    const mockResponse = { height: 5000 }
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    })

    const account: NamadaKeychainAccount = {
      address: 'tnam1q9gr66cvu4hrzm0sd5kmlnjje82gs3xlfg3v6nu7',
      viewingKey: 'viewing-key-123',
      source: 'generated',
      timestamp: 1700000000000,
    }

    const vk = await normalizeViewingKey(account)
    expect(vk).toEqual({
      key: 'viewing-key-123',
      birthday: 5000,
    })
  })

  it('throws when account has no viewing key', async () => {
    const account: NamadaKeychainAccount = {
      address: 'tnam1q9gr66cvu4hrzm0sd5kmlnjje82gs3xlfg3v6nu7',
    }

    await expect(normalizeViewingKey(account)).rejects.toThrow('does not have a viewing key')
  })
})

describe('normalizeViewingKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(env.namadaIndexerUrl).mockReturnValue('https://indexer.testnet.siuuu.click')
  })

  it('normalizes multiple viewing keys', async () => {
    const mockResponse = { height: 5000 }
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    })

    const accounts: NamadaKeychainAccount[] = [
      {
        address: 'tnam1q9gr66cvu4hrzm0sd5kmlnjje82gs3xlfg3v6nu7',
        viewingKey: 'viewing-key-1',
        source: 'generated',
        timestamp: 1700000000000,
      },
      {
        address: 'tnam1q9gr66cvu4hrzm0sd5kmlnjje82gs3xlfg3v6nu8',
        viewingKey: 'viewing-key-2',
        source: 'generated',
        timestamp: 1700000000000,
      },
    ]

    const vks = await normalizeViewingKeys(accounts)
    expect(vks).toHaveLength(2)
    expect(vks[0]).toEqual({ key: 'viewing-key-1', birthday: 5000 })
    expect(vks[1]).toEqual({ key: 'viewing-key-2', birthday: 5000 })
  })

  it('filters out accounts without viewing keys', async () => {
    const accounts: NamadaKeychainAccount[] = [
      {
        address: 'tnam1q9gr66cvu4hrzm0sd5kmlnjje82gs3xlfg3v6nu7',
        viewingKey: 'viewing-key-1',
        source: 'generated',
        timestamp: 1700000000000,
      },
      {
        address: 'tnam1q9gr66cvu4hrzm0sd5kmlnjje82gs3xlfg3v6nu8',
        // No viewing key
      },
    ]

    const vks = await normalizeViewingKeys(accounts)
    expect(vks).toHaveLength(1)
    expect(vks[0].key).toBe('viewing-key-1')
  })
})

describe('ensureMaspReady', () => {
  it('loads params when they exist', async () => {
    const mockMasp = {
      hasMaspParams: vi.fn().mockResolvedValue(true),
      loadMaspParams: vi.fn().mockResolvedValue(undefined),
      fetchAndStoreMaspParams: vi.fn().mockResolvedValue(undefined),
    }
    const mockSdk = { masp: mockMasp } as unknown as Sdk

    await ensureMaspReady({ sdk: mockSdk, chainId: 'test-chain' })

    expect(mockMasp.hasMaspParams).toHaveBeenCalled()
    expect(mockMasp.loadMaspParams).toHaveBeenCalledWith('', 'test-chain')
    expect(mockMasp.fetchAndStoreMaspParams).not.toHaveBeenCalled()
  })

  it('fetches and stores params when missing', async () => {
    const mockMasp = {
      hasMaspParams: vi.fn().mockResolvedValue(false),
      fetchAndStoreMaspParams: vi.fn().mockResolvedValue(undefined),
      loadMaspParams: vi.fn().mockResolvedValue(undefined),
    }
    const mockSdk = { masp: mockMasp } as unknown as Sdk

    await ensureMaspReady({
      sdk: mockSdk,
      chainId: 'test-chain',
      paramsUrl: 'https://params.example.com',
    })

    expect(mockMasp.hasMaspParams).toHaveBeenCalled()
    expect(mockMasp.fetchAndStoreMaspParams).toHaveBeenCalledWith('https://params.example.com')
    expect(mockMasp.loadMaspParams).toHaveBeenCalledWith('', 'test-chain')
  })

  it('throws when params are missing and no paramsUrl provided', async () => {
    const mockMasp = {
      hasMaspParams: vi.fn().mockResolvedValue(false),
    }
    const mockSdk = { masp: mockMasp } as unknown as Sdk

    await expect(ensureMaspReady({ sdk: mockSdk, chainId: 'test-chain' })).rejects.toThrow(
      'MASP params not available and paramsUrl not provided',
    )
  })
})

describe('hasMaspParams', () => {
  it('checks if MASP params are available', async () => {
    const mockMasp = {
      hasMaspParams: vi.fn().mockResolvedValue(true),
    }
    const mockSdk = { masp: mockMasp } as unknown as Sdk

    const result = await hasMaspParams(mockSdk)
    expect(result).toBe(true)
    expect(mockMasp.hasMaspParams).toHaveBeenCalled()
  })
})

describe('clearShieldedContext', () => {
  it('clears shielded context for a chain', async () => {
    const mockMasp = {
      clearShieldedContext: vi.fn().mockResolvedValue(undefined),
    }
    const mockSdk = { masp: mockMasp } as unknown as Sdk

    await clearShieldedContext(mockSdk, 'test-chain')

    expect(mockMasp.clearShieldedContext).toHaveBeenCalledWith('test-chain')
  })
})

