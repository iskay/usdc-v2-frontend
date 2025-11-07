/**
 * Deposit validation utilities for amount, Namada address, and form validation.
 * Used in Deposit flow (EVM → Namada).
 */

export interface AmountValidation {
  isValid: boolean
  error: string | null
}

export interface AddressValidation {
  isValid: boolean
  error: string | null
}

export interface DepositFormValidation {
  isValid: boolean
  amountError: string | null
  addressError: string | null
}

/**
 * Namada bech32 address regex pattern: starts with 'tnam' followed by valid bech32 characters
 * Bech32 format: HRP (tnam) + separator (1) + data (base32: a-z, 2-7)
 * Approximate validation - full bech32 validation would require decoding
 * Pattern: tnam followed by at least one character (typically '1' separator) then base32 characters
 */
const NAMADA_ADDRESS_REGEX = /^tnam[a-z0-9]{39,}$/

/**
 * Validates deposit amount considering available balance and estimated fees.
 * Amount + estimated fee must not exceed available balance.
 *
 * @param amount - The amount to validate (as string)
 * @param availableBalance - The available EVM balance (as string)
 * @param estimatedFee - The estimated fee for the transaction (as string)
 * @returns Validation result with isValid flag and error message
 */
export function validateDepositAmount(
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
 * Validates Namada bech32 address format using regex pattern.
 * Accepts addresses that start with 'tnam' followed by valid bech32 characters.
 *
 * @param address - The Namada address to validate
 * @returns Validation result with isValid flag and error message
 */
export function validateNamadaAddress(address: string): AddressValidation {
  // Check for empty address
  if (!address || address.trim() === '') {
    return { isValid: false, error: 'Please enter a Namada address' }
  }

  // Trim whitespace
  const trimmedAddress = address.trim()

  // Check Namada bech32 address format: must start with 'tnam'
  if (!trimmedAddress.startsWith('tnam')) {
    return {
      isValid: false,
      error: 'Invalid Namada address format. Address must start with "tnam"',
    }
  }

  // Check bech32 format: tnam followed by valid characters
  // Minimum length check: tnam (4) + at least 39 more characters = 43 total minimum
  if (trimmedAddress.length < 43) {
    return {
      isValid: false,
      error: 'Invalid Namada address format. Address is too short',
    }
  }

  // Check format with regex: tnam followed by alphanumeric characters
  if (!NAMADA_ADDRESS_REGEX.test(trimmedAddress)) {
    return {
      isValid: false,
      error: 'Invalid Namada address format. Expected: tnam followed by valid bech32 characters',
    }
  }

  return { isValid: true, error: null }
}

/**
 * Validates the complete deposit form (amount and address).
 * Combines amount and address validation results.
 *
 * @param amount - The amount to validate
 * @param availableBalance - The available EVM balance
 * @param estimatedFee - The estimated fee for the transaction
 * @param address - The destination Namada address
 * @returns Combined validation result with isValid flag and individual error messages
 */
export function validateDepositForm(
  amount: string,
  availableBalance: string,
  estimatedFee: string,
  address: string
): DepositFormValidation {
  const amountValidation = validateDepositAmount(amount, availableBalance, estimatedFee)
  const addressValidation = validateNamadaAddress(address)

  return {
    isValid: amountValidation.isValid && addressValidation.isValid,
    amountError: amountValidation.error,
    addressError: addressValidation.error,
  }
}

