import { describe, it, expect } from 'vitest'
import {
  validateDepositAmount,
  validateNamadaAddress,
  validateDepositForm,
} from '../depositValidation'

describe('depositValidation', () => {
  describe('validateDepositAmount', () => {
    it('should return error for empty amount', () => {
      const result = validateDepositAmount('', '100.00', '0.12')
      expect(result.isValid).toBe(false)
      expect(result.error).toBe('Please enter an amount')
    })

    it('should return error for invalid number', () => {
      const result = validateDepositAmount('abc', '100.00', '0.12')
      expect(result.isValid).toBe(false)
      expect(result.error).toBe('Please enter a valid amount')
    })

    it('should return error when amount + fee exceeds balance', () => {
      const result = validateDepositAmount('100.00', '100.00', '0.12')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('Amount exceeds available balance')
    })

    it('should return valid for amount within balance after fee', () => {
      const result = validateDepositAmount('50.00', '100.00', '0.12')
      expect(result.isValid).toBe(true)
      expect(result.error).toBeNull()
    })
  })

  describe('validateNamadaAddress', () => {
    it('should return error for empty address', () => {
      const result = validateNamadaAddress('')
      expect(result.isValid).toBe(false)
      expect(result.error).toBe('Please enter a Namada address')
    })

    it('should return error for address without tnam prefix', () => {
      const result = validateNamadaAddress('0x1234567890123456789012345678901234567890')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('must start with "tnam"')
    })

    it('should return error for address starting with nam (mainnet)', () => {
      const result = validateNamadaAddress('nam1qy352euf40x77q2k8mmyh8d4zfxvzekyfz4q0q')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('must start with "tnam"')
    })

    it('should return error for address that is too short', () => {
      const result = validateNamadaAddress('tnam1short')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('too short')
    })

    it('should return valid for correct Namada testnet address', () => {
      const result = validateNamadaAddress('tnam1qy352euf40x77q2k8mmyh8d4zfxvzekyfz4q0q')
      expect(result.isValid).toBe(true)
      expect(result.error).toBeNull()
    })

    it('should return valid for another valid Namada address', () => {
      const result = validateNamadaAddress('tnam1q9gr66cvu4hrzm0sd5kmlnjje82gs3xlfg3v6nu7')
      expect(result.isValid).toBe(true)
      expect(result.error).toBeNull()
    })
  })

  describe('validateDepositForm', () => {
    it('should return invalid when both amount and address are invalid', () => {
      const result = validateDepositForm('', '100.00', '0.12', '')
      expect(result.isValid).toBe(false)
      expect(result.amountError).toBe('Please enter an amount')
      expect(result.addressError).toBe('Please enter a Namada address')
    })

    it('should return valid when both amount and address are valid', () => {
      const result = validateDepositForm('50.00', '100.00', '0.12', 'tnam1qy352euf40x77q2k8mmyh8d4zfxvzekyfz4q0q')
      expect(result.isValid).toBe(true)
      expect(result.amountError).toBeNull()
      expect(result.addressError).toBeNull()
    })
  })
})

