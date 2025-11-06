import { describe, expect, it, vi, beforeEach } from 'vitest'
import { formatMinDenom, queryShieldedBalances, queryShieldedUSDCBalance, getFormattedShieldedUSDCBalance } from '../shieldedBalanceHelpers'
import { getNamadaSdk } from '@/services/namada/namadaSdkService'
import { getUSDCAddressFromRegistry } from '@/services/namada/namadaBalanceService'

// Mock the SDK
vi.mock('@/services/namada/namadaSdkService', () => ({
  getNamadaSdk: vi.fn(),
}))

// Mock the balance service
vi.mock('@/services/namada/namadaBalanceService', () => ({
  getUSDCAddressFromRegistry: vi.fn(),
}))

describe('shieldedBalanceHelpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('formatMinDenom', () => {
    it('formats min denom amount correctly', () => {
      expect(formatMinDenom('123456789', 6)).toBe('123.456789')
      expect(formatMinDenom('1000000', 6)).toBe('1.000000')
      expect(formatMinDenom('0', 6)).toBe('0.000000')
      expect(formatMinDenom('500000', 6)).toBe('0.500000')
    })

    it('handles edge cases', () => {
      expect(formatMinDenom('', 6)).toBe('0.000000')
      expect(formatMinDenom('invalid', 6)).toBe('0.000000')
    })
  })

  describe('queryShieldedBalances', () => {
    it('queries shielded balances successfully', async () => {
      const mockSdk = {
        rpc: {
          queryBalance: vi.fn().mockResolvedValue([
            ['token1', '1000000'],
            ['token2', '2000000'],
          ]),
        },
      }
      vi.mocked(getNamadaSdk).mockReturnValue(mockSdk as any)

      const result = await queryShieldedBalances('viewing-key', ['token1', 'token2'], 'chain-id')

      expect(result).toEqual([
        ['token1', '1000000'],
        ['token2', '2000000'],
      ])
      expect(mockSdk.rpc.queryBalance).toHaveBeenCalledWith('viewing-key', ['token1', 'token2'], 'chain-id')
    })

    it('returns empty array when no token addresses provided', async () => {
      const result = await queryShieldedBalances('viewing-key', [], 'chain-id')
      expect(result).toEqual([])
    })

    it('handles errors gracefully', async () => {
      const mockSdk = {
        rpc: {
          queryBalance: vi.fn().mockRejectedValue(new Error('Query failed')),
        },
      }
      vi.mocked(getNamadaSdk).mockReturnValue(mockSdk as any)

      const result = await queryShieldedBalances('viewing-key', ['token1'], 'chain-id')
      expect(result).toEqual([])
    })
  })

  describe('queryShieldedUSDCBalance', () => {
    it('queries USDC balance successfully', async () => {
      const mockSdk = {
        rpc: {
          queryBalance: vi.fn().mockResolvedValue([
            ['usdc-address', '1000000'],
          ]),
        },
      }
      vi.mocked(getNamadaSdk).mockReturnValue(mockSdk as any)
      vi.mocked(getUSDCAddressFromRegistry).mockResolvedValue('usdc-address')

      const result = await queryShieldedUSDCBalance('viewing-key', 'chain-id')

      expect(result).toBe('1000000')
      expect(mockSdk.rpc.queryBalance).toHaveBeenCalledWith('viewing-key', ['usdc-address'], 'chain-id')
    })

    it('returns 0 when USDC address not configured', async () => {
      vi.mocked(getUSDCAddressFromRegistry).mockResolvedValue(null)

      const result = await queryShieldedUSDCBalance('viewing-key', 'chain-id')
      expect(result).toBe('0')
    })

    it('returns 0 when USDC balance not found', async () => {
      const mockSdk = {
        rpc: {
          queryBalance: vi.fn().mockResolvedValue([
            ['other-token', '1000000'],
          ]),
        },
      }
      vi.mocked(getNamadaSdk).mockReturnValue(mockSdk as any)
      vi.mocked(getUSDCAddressFromRegistry).mockResolvedValue('usdc-address')

      const result = await queryShieldedUSDCBalance('viewing-key', 'chain-id')
      expect(result).toBe('0')
    })
  })

  describe('getFormattedShieldedUSDCBalance', () => {
    it('returns formatted USDC balance', async () => {
      const mockSdk = {
        rpc: {
          queryBalance: vi.fn().mockResolvedValue([
            ['usdc-address', '123456789'],
          ]),
        },
      }
      vi.mocked(getNamadaSdk).mockReturnValue(mockSdk as any)
      vi.mocked(getUSDCAddressFromRegistry).mockResolvedValue('usdc-address')

      const result = await getFormattedShieldedUSDCBalance('viewing-key', 'chain-id')

      expect(result).toBe('123.456789')
    })

    it('returns 0.000000 when balance is 0', async () => {
      const mockSdk = {
        rpc: {
          queryBalance: vi.fn().mockResolvedValue([
            ['usdc-address', '0'],
          ]),
        },
      }
      vi.mocked(getNamadaSdk).mockReturnValue(mockSdk as any)
      vi.mocked(getUSDCAddressFromRegistry).mockResolvedValue('usdc-address')

      const result = await getFormattedShieldedUSDCBalance('viewing-key', 'chain-id')

      expect(result).toBe('0.000000')
    })
  })
})

