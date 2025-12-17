import { saveItem, loadItem } from './localStore'

const STORAGE_KEY = 'noble-fallback-derived'

interface DerivedFallbackEntry {
  nobleAddress: string
  evmAddress?: string // Optional for backward compatibility (can be derived from storage key)
  publicKey?: string
  derivedAt: number
}

interface DerivedFallbackStorage {
  [evmAddress: string]: DerivedFallbackEntry
}

/**
 * Load all derived fallback addresses from localStorage
 */
function loadDerivedStorage(): DerivedFallbackStorage {
  return loadItem<DerivedFallbackStorage>(STORAGE_KEY) || {}
}

/**
 * Save all derived fallback addresses to localStorage
 */
function saveDerivedStorage(storage: DerivedFallbackStorage): void {
  saveItem(STORAGE_KEY, storage)
}

/**
 * Save a derived Noble fallback address for a specific EVM address
 * @param evmAddress - The EVM address (used as key)
 * @param nobleAddress - The derived Noble bech32 address
 * @param publicKey - Optional public key used for derivation
 */
export function saveDerivedFallbackAddress(
  evmAddress: string,
  nobleAddress: string,
  publicKey?: string
): void {
  const storage = loadDerivedStorage()
  const normalizedEvmAddress = evmAddress.toLowerCase()
  
  storage[normalizedEvmAddress] = {
    nobleAddress,
    evmAddress: evmAddress, // Store the EVM address explicitly for easier access
    publicKey,
    derivedAt: Date.now(),
  }
  
  saveDerivedStorage(storage)
}

/**
 * Load a derived Noble fallback address for a specific EVM address
 * @param evmAddress - The EVM address to look up
 * @returns The Noble address if found, undefined otherwise
 */
export function loadDerivedFallbackAddress(evmAddress: string): string | undefined {
  const storage = loadDerivedStorage()
  const normalizedEvmAddress = evmAddress.toLowerCase()
  const entry = storage[normalizedEvmAddress]
  
  return entry?.nobleAddress
}

/**
 * Get all derived fallback addresses (for debugging/admin purposes)
 * @returns Record mapping EVM addresses to Noble addresses
 */
export function getAllDerivedFallbackAddresses(): Record<string, string> {
  const storage = loadDerivedStorage()
  const result: Record<string, string> = {}
  
  for (const [evmAddress, entry] of Object.entries(storage)) {
    result[evmAddress] = entry.nobleAddress
  }
  
  return result
}

/**
 * Clear a derived fallback address for a specific EVM address
 * @param evmAddress - The EVM address to clear
 */
export function clearDerivedFallbackAddress(evmAddress: string): void {
  const storage = loadDerivedStorage()
  const normalizedEvmAddress = evmAddress.toLowerCase()
  
  if (storage[normalizedEvmAddress]) {
    delete storage[normalizedEvmAddress]
    saveDerivedStorage(storage)
  }
}

/**
 * Get the full entry (including metadata) for a derived fallback address
 * @param evmAddress - The EVM address to look up
 * @returns The full entry if found, undefined otherwise
 */
export function getDerivedFallbackEntry(evmAddress: string): DerivedFallbackEntry | undefined {
  const storage = loadDerivedStorage()
  const normalizedEvmAddress = evmAddress.toLowerCase()
  return storage[normalizedEvmAddress]
}

/**
 * Get all derived fallback entries with their EVM addresses
 * @returns Array of entries with EVM address and Noble address
 */
export function getAllDerivedFallbackEntries(): Array<{ evmAddress: string; nobleAddress: string; entry: DerivedFallbackEntry }> {
  const storage = loadDerivedStorage()
  const result: Array<{ evmAddress: string; nobleAddress: string; entry: DerivedFallbackEntry }> = []
  
  for (const [evmAddress, entry] of Object.entries(storage)) {
    result.push({
      evmAddress: entry.evmAddress || evmAddress, // Use explicit evmAddress if available, otherwise use key
      nobleAddress: entry.nobleAddress,
      entry,
    })
  }
  
  return result
}
