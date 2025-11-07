import { describe, it, expect } from 'vitest'
import {
  validatePaymentAmount,
  validateEvmAddress,
  validatePaymentForm,
} from '../paymentValidation'

describe('paymentValidation', () => {
  describe('validatePaymentAmount', () => {
    it('should return error for empty amount', () => {
      const result = validatePaymentAmount('', '100.00', '0.12')
      expect(result.isValid).toBe(false)
      expect(result.error).toBe('Please enter an amount')
    })

    it('should return error for whitespace-only amount', () => {
      const result = validatePaymentAmount('   ', '100.00', '0.12')
      expect(result.isValid).toBe(false)
      expect(result.error).toBe('Please enter an amount')
    })

    it('should return error for invalid number', () => {
      const result = validatePaymentAmount('abc', '100.00', '0.12')
      expect(result.isValid).toBe(false)
      expect(result.error).toBe('Please enter a valid amount')
    })

    it('should return error for zero amount', () => {
      const result = validatePaymentAmount('0', '100.00', '0.12')
      expect(result.isValid).toBe(false)
      expect(result.error).toBe('Please enter a valid amount')
    })

    it('should return error for negative amount', () => {
      const result = validatePaymentAmount('-10', '100.00', '0.12')
      expect(result.isValid).toBe(false)
      expect(result.error).toBe('Please enter a valid amount')
    })

    it('should return error when amount + fee exceeds balance', () => {
      const result = validatePaymentAmount('100.00', '100.00', '0.12')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('Amount exceeds available balance')
    })

    it('should return error when fee alone exceeds balance', () => {
      const result = validatePaymentAmount('1.00', '0.10', '0.12')
      expect(result.isValid).toBe(false)
      expect(result.error).toBe('Insufficient balance to cover fees')
    })

    it('should return valid for amount within balance after fee', () => {
      const result = validatePaymentAmount('50.00', '100.00', '0.12')
      expect(result.isValid).toBe(true)
      expect(result.error).toBeNull()
    })

    it('should return valid for amount exactly at balance minus fee', () => {
      const result = validatePaymentAmount('99.88', '100.00', '0.12')
      expect(result.isValid).toBe(true)
      expect(result.error).toBeNull()
    })

    it('should handle decimal amounts correctly', () => {
      const result = validatePaymentAmount('10.50', '100.00', '0.12')
      expect(result.isValid).toBe(true)
      expect(result.error).toBeNull()
    })
  })

  describe('validateEvmAddress', () => {
    it('should return error for empty address', () => {
      const result = validateEvmAddress('')
      expect(result.isValid).toBe(false)
      expect(result.error).toBe('Please enter a destination address')
    })

    it('should return error for whitespace-only address', () => {
      const result = validateEvmAddress('   ')
      expect(result.isValid).toBe(false)
      expect(result.error).toBe('Please enter a destination address')
    })

    it('should return error for address without 0x prefix', () => {
      const result = validateEvmAddress('1234567890123456789012345678901234567890')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('Invalid EVM address format')
    })

    it('should return error for address with wrong length', () => {
      const result = validateEvmAddress('0x123456789012345678901234567890123456789')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('Invalid EVM address format')
    })

    it('should return error for address with invalid characters', () => {
      const result = validateEvmAddress('0x123456789012345678901234567890123456789g')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('Invalid EVM address format')
    })

    it('should return valid for correct EVM address (lowercase)', () => {
      const result = validateEvmAddress('0x1234567890123456789012345678901234567890')
      expect(result.isValid).toBe(true)
      expect(result.error).toBeNull()
    })

    it('should return valid for correct EVM address (uppercase)', () => {
      const result = validateEvmAddress('0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD')
      expect(result.isValid).toBe(true)
      expect(result.error).toBeNull()
    })

    it('should return valid for correct EVM address (mixed case)', () => {
      const result = validateEvmAddress('0xAbCdEf1234567890123456789012345678901234')
      expect(result.isValid).toBe(true)
      expect(result.error).toBeNull()
    })

    it('should trim whitespace before validation', () => {
      const result = validateEvmAddress('  0x1234567890123456789012345678901234567890  ')
      expect(result.isValid).toBe(true)
      expect(result.error).toBeNull()
    })
  })

  describe('validatePaymentForm', () => {
    it('should return invalid when both amount and address are invalid', () => {
      const result = validatePaymentForm('', '100.00', '0.12', '')
      expect(result.isValid).toBe(false)
      expect(result.amountError).toBe('Please enter an amount')
      expect(result.addressError).toBe('Please enter a destination address')
    })

    it('should return invalid when only amount is invalid', () => {
      const result = validatePaymentForm('', '100.00', '0.12', '0x1234567890123456789012345678901234567890')
      expect(result.isValid).toBe(false)
      expect(result.amountError).toBe('Please enter an amount')
      expect(result.addressError).toBeNull()
    })

    it('should return invalid when only address is invalid', () => {
      const result = validatePaymentForm('50.00', '100.00', '0.12', '')
      expect(result.isValid).toBe(false)
      expect(result.amountError).toBeNull()
      expect(result.addressError).toBe('Please enter a destination address')
    })

    it('should return invalid when amount exceeds balance', () => {
      const result = validatePaymentForm('100.00', '100.00', '0.12', '0x1234567890123456789012345678901234567890')
      expect(result.isValid).toBe(false)
      expect(result.amountError).toContain('Amount exceeds available balance')
      expect(result.addressError).toBeNull()
    })

    it('should return valid when both amount and address are valid', () => {
      const result = validatePaymentForm('50.00', '100.00', '0.12', '0x1234567890123456789012345678901234567890')
      expect(result.isValid).toBe(true)
      expect(result.amountError).toBeNull()
      expect(result.addressError).toBeNull()
    })
  })
})

