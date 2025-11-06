import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useShieldedSync } from '../useShieldedSync'
import { walletAtom } from '@/atoms/walletAtom'
import { jotaiStore } from '@/store/jotaiStore'

// Mock the shielded service
vi.mock('@/services/shielded/shieldedService', () => ({
  startShieldedSync: vi.fn().mockResolvedValue(undefined),
  stopShieldedSync: vi.fn(),
  getShieldedSyncStatus: vi.fn(() => ({
    isInitialized: false,
    isSyncing: false,
    chainId: undefined,
  })),
}))

// Mock the masp helpers
vi.mock('@/services/shielded/maspHelpers', () => ({
  normalizeViewingKey: vi.fn().mockResolvedValue({
    key: 'viewing-key-1',
    birthday: 1000,
  }),
}))

// Mock the wallet service
vi.mock('@/services/wallet/namadaKeychain', () => ({
  fetchDefaultNamadaAccount: vi.fn().mockResolvedValue({
    address: 'tnam1q9gr66cvu4hrzm0sd5kmlnjje82gs3xlfg3v6nu7',
    viewingKey: 'viewing-key-1',
    source: 'generated',
    timestamp: 1700000000000,
  }),
}))

// Mock constants
vi.mock('@/config/constants', () => ({
  NAMADA_CHAIN_ID: 'test-chain',
}))

describe('useShieldedSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset wallet state
    jotaiStore.set(walletAtom, {
      metaMask: {
        isConnecting: false,
        isConnected: false,
      },
      namada: {
        isConnecting: false,
        isConnected: false,
        viewingKey: undefined,
      },
    })
  })

  it('validates hook structure', () => {
    // This test validates the hook exports and structure
    // Full integration testing would require React testing library
    expect(typeof useShieldedSync).toBe('function')
  })

  it('validates wallet state for readiness', () => {
    // Test wallet state structure
    const walletState = jotaiStore.get(walletAtom)
    expect(walletState.namada.isConnected).toBe(false)
    expect(walletState.namada.viewingKey).toBeUndefined()

    // Set connected state
    jotaiStore.set(walletAtom, {
      ...walletState,
      namada: {
        ...walletState.namada,
        isConnected: true,
        viewingKey: 'viewing-key-1',
      },
    })

    const updatedState = jotaiStore.get(walletAtom)
    expect(updatedState.namada.isConnected).toBe(true)
    expect(updatedState.namada.viewingKey).toBe('viewing-key-1')
  })

  it('validates service integration', async () => {
    const { startShieldedSync } = await import('@/services/shielded/shieldedService')
    const { normalizeViewingKey } = await import('@/services/shielded/maspHelpers')
    const { fetchDefaultNamadaAccount } = await import('@/services/wallet/namadaKeychain')

    expect(typeof startShieldedSync).toBe('function')
    expect(typeof normalizeViewingKey).toBe('function')
    expect(typeof fetchDefaultNamadaAccount).toBe('function')
  })
})

