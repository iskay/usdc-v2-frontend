/**
 * Address book validation utilities.
 * Provides reusable validation functions for address book operations.
 */

import { getAllAddresses, addressExists } from '@/services/addressBook/addressBookService'
import type { AddressBookEntry } from '@/services/addressBook/types'

export interface ValidationResult {
  isValid: boolean
  error: string | null
}

/**
 * Validates an address book name.
 * Checks if name is provided, not empty, and unique.
 *
 * @param name - The name to validate
 * @param address - The address associated with the name (for context)
 * @param excludeId - Optional entry ID to exclude from uniqueness check (for edits)
 * @returns Validation result with isValid flag and error message
 */
export function validateAddressBookName(
  name: string,
  address: string,
  excludeId?: string
): ValidationResult {
  // Check if name is provided
  if (!name || name.trim() === '') {
    return {
      isValid: false,
      error: 'Name is required',
    }
  }

  // Check if address is valid (must not be empty)
  if (!address || address.trim() === '') {
    return {
      isValid: false,
      error: 'Please enter a valid address first',
    }
  }

  // Check if address already exists in address book
  if (addressExists(address)) {
    return {
      isValid: false,
      error: 'Address already exists in address book',
    }
  }

  // Check if name is unique
  const existingEntries = getAllAddresses()
  const duplicateName = existingEntries.find(
    (entry) =>
      entry.name.toLowerCase() === name.trim().toLowerCase() &&
      (!excludeId || entry.id !== excludeId)
  )

  if (duplicateName) {
    return {
      isValid: false,
      error: `Name "${duplicateName.name}" already exists in address book`,
    }
  }

  return {
    isValid: true,
    error: null,
  }
}

/**
 * Checks if a name is unique in the address book.
 *
 * @param name - The name to check
 * @param excludeId - Optional entry ID to exclude from check (for edits)
 * @returns True if name is unique, false otherwise
 */
export function checkNameUniqueness(name: string, excludeId?: string): boolean {
  const existingEntries = getAllAddresses()
  const duplicate = existingEntries.find(
    (entry) =>
      entry.name.toLowerCase() === name.trim().toLowerCase() &&
      (!excludeId || entry.id !== excludeId)
  )
  return !duplicate
}

/**
 * Checks if an address exists in the address book.
 * This is a wrapper around the service function for consistency.
 *
 * @param address - The address to check
 * @returns True if address exists, false otherwise
 */
export function checkAddressExists(address: string): boolean {
  return addressExists(address)
}

/**
 * Finds an address book entry by address.
 *
 * @param address - The address to search for
 * @returns The address book entry if found, null otherwise
 */
export function findAddressBookEntry(address: string): AddressBookEntry | null {
  const entries = getAllAddresses()
  return (
    entries.find((entry) => entry.address.toLowerCase() === address.toLowerCase().trim()) ?? null
  )
}

