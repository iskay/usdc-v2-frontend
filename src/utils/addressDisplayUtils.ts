import { getAllAddresses } from '@/services/addressBook/addressBookService'
import { formatAddress } from '@/utils/toastHelpers'
import type { StoredTransaction } from '@/services/tx/transactionStorageService'

/**
 * Address display information
 */
export interface AddressDisplayInfo {
  display: string
  isFromAddressBook: boolean
  fullAddress: string
}

/**
 * Get address display information (name from address book or truncated address)
 * 
 * @param address - The address to display
 * @returns Address display info or null if address is undefined
 */
export function getAddressDisplay(address: string | undefined): AddressDisplayInfo | null {
  if (!address) return null
  
  // Check if address is in address book
  const addressBookEntry = getAllAddresses().find(
    (entry) => entry.address.toLowerCase() === address.toLowerCase().trim()
  )
  
  if (addressBookEntry) {
    return { 
      display: addressBookEntry.name, 
      isFromAddressBook: true,
      fullAddress: address
    }
  }
  
  // Return truncated address
  return { 
    display: formatAddress(address), 
    isFromAddressBook: false,
    fullAddress: address
  }
}

/**
 * Check if a Namada address is a disposable address for a send transaction
 * 
 * @param address - The address to check
 * @param transaction - The transaction to check against
 * @returns True if the address is a disposable Namada address for this transaction
 */
export function isDisposableNamadaAddress(
  address: string | undefined,
  transaction: StoredTransaction
): boolean {
  if (!address || transaction.direction !== 'send') {
    return false
  }
  
  // For sends, check if address matches paymentData.disposableSignerAddress
  const txWithPaymentData = transaction as StoredTransaction & { 
    paymentData?: { disposableSignerAddress?: string } 
  }
  
  const disposableSignerAddress = txWithPaymentData.paymentData?.disposableSignerAddress
  
  if (!disposableSignerAddress) {
    return false
  }
  
  // Case-insensitive comparison
  return address.toLowerCase().trim() === disposableSignerAddress.toLowerCase().trim()
}

