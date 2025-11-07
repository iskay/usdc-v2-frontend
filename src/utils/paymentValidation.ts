/**
 * Payment validation utilities for amount, address, and form validation.
 * Used in both Send (Payment) and Deposit flows.
 */

export interface AmountValidation {
  isValid: boolean
  error: string | null
}

export interface AddressValidation {
  isValid: boolean
  error: string | null
}

export interface PaymentFormValidation {
  isValid: boolean
  amountError: string | null
  addressError: string | null
}

/**
 * EVM address regex pattern: 0x followed by exactly 40 hexadecimal characters
 */
const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/

/**
 * Validates payment amount considering available balance and estimated fees.
 * Amount + estimated fee must not exceed available balance.
 *
 * @param amount - The amount to validate (as string)
 * @param availableBalance - The available shielded balance (as string)
 * @param estimatedFee - The estimated fee for the transaction (as string)
 * @returns Validation result with isValid flag and error message
 */
export function validatePaymentAmount(
  amount: string,
  availableBalance: string,
  estimatedFee: string
): AmountValidation {
  // Check for empty amount
  if (!amount || amount.trim() === '') {
    return { isValid: false, error: 'Please enter an amount' }
  }

  // Parse numeric values
  const numAmount = parseFloat(amount)
  const numAvailable = parseFloat(availableBalance)
  const numFee = parseFloat(estimatedFee)

  // Check if amount is a valid positive number
  if (isNaN(numAmount) || numAmount <= 0) {
    return { isValid: false, error: 'Please enter a valid amount' }
  }

  // Check if available balance is valid
  if (isNaN(numAvailable) || numAvailable < 0) {
    return { isValid: false, error: 'Invalid available balance' }
  }

  // Check if fee is valid
  if (isNaN(numFee) || numFee < 0) {
    return { isValid: false, error: 'Invalid fee estimation' }
  }

  // Check if amount + fee exceeds available balance
  const totalRequired = numAmount + numFee
  if (totalRequired > numAvailable) {
    const availableAfterFee = numAvailable - numFee
    if (availableAfterFee <= 0) {
      return {
        isValid: false,
        error: 'Insufficient balance to cover fees',
      }
    }
    return {
      isValid: false,
      error: `Amount exceeds available balance. Maximum: $${availableAfterFee.toFixed(2)}`,
    }
  }

  return { isValid: true, error: null }
}

/**
 * Validates EVM address format using regex pattern.
 * Accepts addresses that start with 0x followed by exactly 40 hexadecimal characters.
 *
 * @param address - The EVM address to validate
 * @returns Validation result with isValid flag and error message
 */
export function validateEvmAddress(address: string): AddressValidation {
  // Check for empty address
  if (!address || address.trim() === '') {
    return { isValid: false, error: 'Please enter a destination address' }
  }

  // Trim whitespace
  const trimmedAddress = address.trim()

  // Check EVM address format
  if (!EVM_ADDRESS_REGEX.test(trimmedAddress)) {
    return {
      isValid: false,
      error: 'Invalid EVM address format. Expected: 0x followed by 40 hexadecimal characters',
    }
  }

  return { isValid: true, error: null }
}

/**
 * Validates the complete payment form (amount and address).
 * Combines amount and address validation results.
 *
 * @param amount - The amount to validate
 * @param availableBalance - The available shielded balance
 * @param estimatedFee - The estimated fee for the transaction
 * @param address - The destination EVM address
 * @returns Combined validation result with isValid flag and individual error messages
 */
export function validatePaymentForm(
  amount: string,
  availableBalance: string,
  estimatedFee: string,
  address: string
): PaymentFormValidation {
  const amountValidation = validatePaymentAmount(amount, availableBalance, estimatedFee)
  const addressValidation = validateEvmAddress(address)

  return {
    isValid: amountValidation.isValid && addressValidation.isValid,
    amountError: amountValidation.error,
    addressError: addressValidation.error,
  }
}

