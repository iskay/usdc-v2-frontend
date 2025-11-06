const STORAGE_PREFIX = 'usdc-v2-frontend'

function withPrefix(key: string): string {
  return `${STORAGE_PREFIX}:${key}`
}

export function saveItem<T>(key: string, value: T): void {
  try {
    localStorage.setItem(withPrefix(key), JSON.stringify(value))
  } catch (error) {
    console.warn('Failed to persist item', key, error)
  }
}

export function loadItem<T>(key: string): T | undefined {
  const value = localStorage.getItem(withPrefix(key))
  if (!value) return undefined
  try {
    return JSON.parse(value) as T
  } catch (error) {
    console.warn('Failed to read item', key, error)
    return undefined
  }
}

export function deleteItem(key: string): void {
  localStorage.removeItem(withPrefix(key))
}

// TODO: Encrypt sensitive data before storing in localStorage.
