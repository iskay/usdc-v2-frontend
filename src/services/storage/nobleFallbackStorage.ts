import { saveItem, loadItem, deleteItem } from './localStore'

const STORAGE_KEY = 'noble-fallback-address'

/**
 * Load Noble fallback address from localStorage
 */
export function loadNobleFallbackAddress(): string | undefined {
  return loadItem<string>(STORAGE_KEY)
}

/**
 * Save Noble fallback address to localStorage
 */
export function saveNobleFallbackAddress(address: string | undefined): void {
  if (address === undefined || address === '') {
    deleteItem(STORAGE_KEY)
  } else {
    saveItem(STORAGE_KEY, address)
  }
}

/**
 * Clear Noble fallback address from localStorage
 */
export function clearNobleFallbackAddress(): void {
  deleteItem(STORAGE_KEY)
}
