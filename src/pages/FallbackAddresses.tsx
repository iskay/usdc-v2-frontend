/**
 * Fallback Addresses Page
 * 
 * Displays all unique Noble fallback addresses from the user's transaction history,
 * showing the fallback address, associated EVM address, and USDC balance.
 */

import { useState, useEffect, useCallback } from 'react'
import { BreadcrumbNav } from '@/components/common/BreadcrumbNav'
import { Spinner } from '@/components/common/Spinner'
import { FallbackAddressCard, type FallbackAddressInfo } from '@/components/fallback/FallbackAddressCard'
import { transactionStorageService } from '@/services/tx/transactionStorageService'
import { getAllDerivedFallbackEntries } from '@/services/storage/nobleFallbackDerivedStorage'
import { logger } from '@/utils/logger'

export function FallbackAddresses() {
  const [addresses, setAddresses] = useState<FallbackAddressInfo[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Extract unique fallback addresses from transactions
  const extractAddresses = useCallback(() => {
    try {
      const allTxs = transactionStorageService.getAllTransactions()

      // Filter for deposit transactions
      const depositTxs = allTxs.filter((tx) => tx.direction === 'deposit')

      // Get all derived fallback entries to map Noble addresses to EVM addresses
      const derivedEntries = getAllDerivedFallbackEntries()
      const nobleToEvmMap = new Map<string, string>()
      for (const { nobleAddress, evmAddress } of derivedEntries) {
        nobleToEvmMap.set(nobleAddress.toLowerCase(), evmAddress)
      }

      // Map to store unique addresses (key: fallbackAddress)
      const addressMap = new Map<string, {
        fallbackAddress: string
        evmAddress: string | null
        lastUsedTimestamp: number
      }>()

      depositTxs.forEach((tx) => {
        // Extract fallback address from depositData
        const fallbackAddress = tx.depositData?.fallback as string | undefined

        if (fallbackAddress && fallbackAddress.trim() !== '') {
          // Get transaction timestamp
          const txTimestamp = tx.updatedAt || tx.createdAt

          // Look up EVM address from derived storage
          const evmAddress = nobleToEvmMap.get(fallbackAddress.toLowerCase()) || null

          // Track both the primary address and the max timestamp across all transactions
          const existing = addressMap.get(fallbackAddress)
          if (!existing) {
            // First time seeing this address
            addressMap.set(fallbackAddress, {
              fallbackAddress,
              evmAddress,
              lastUsedTimestamp: txTimestamp,
            })
          } else {
            // Update lastUsedTimestamp to be the maximum across all transactions
            const maxTimestamp = Math.max(existing.lastUsedTimestamp, txTimestamp)
            existing.lastUsedTimestamp = maxTimestamp
          }
        }
      })

      const uniqueAddresses: FallbackAddressInfo[] = Array.from(addressMap.values())

      // Sort by most recent transaction first
      uniqueAddresses.sort((a, b) => {
        return b.lastUsedTimestamp - a.lastUsedTimestamp
      })

      setAddresses(uniqueAddresses)
      setIsLoading(false)
      setError(null)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load fallback addresses'
      logger.error('[FallbackAddresses] Failed to extract addresses', {
        error: errorMessage,
      })
      setError(errorMessage)
      setIsLoading(false)
    }
  }, [])

  // Load addresses on mount and periodically refresh
  useEffect(() => {
    // Load initially
    extractAddresses()

    // Reload periodically to catch new transactions (every 10 seconds)
    const interval = setInterval(extractAddresses, 10000)
    return () => clearInterval(interval)
  }, [extractAddresses])

  return (
    <div className="space-y-6 p-12 mx-auto w-full max-w-7xl">
      <div className="mb-10">
        <BreadcrumbNav />
      </div>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Fallback Addresses</h1>
        <p className="text-muted-foreground">
          View all Noble fallback addresses used in your deposit transactions. These addresses are used for refunds if automatic IBC forwarding to Namada fails.
        </p>
      </header>

      {/* Loading State */}
      {isLoading && (
        <div className="rounded-lg border border-border bg-card p-12 shadow-sm">
          <div className="flex items-center justify-center">
            <Spinner label="Loading fallback addresses..." />
          </div>
        </div>
      )}

      {/* Error State */}
      {error && !isLoading && (
        <div className="rounded-lg border border-error/20 bg-error/10 p-8 text-center shadow-sm">
          <p className="text-base font-semibold text-error">Error loading addresses</p>
          <p className="mt-2 text-sm text-error/90">{error}</p>
          <button
            onClick={extractAddresses}
            className="mt-4 rounded-md bg-error px-4 py-2 text-sm font-medium text-error-foreground hover:bg-error/90 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && addresses.length === 0 && (
        <div className="rounded-lg border border-border bg-card p-12 text-center shadow-sm">
          <p className="text-base text-muted-foreground">
            No fallback addresses found. Fallback addresses will appear here after you make deposit transactions.
          </p>
        </div>
      )}

      {/* Addresses List */}
      {!isLoading && !error && addresses.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Found {addresses.length} unique fallback address{addresses.length !== 1 ? 'es' : ''} in your transaction history
            </p>
          </div>

          <div className="space-y-4">
            {addresses.map((addressInfo) => (
              <FallbackAddressCard
                key={addressInfo.fallbackAddress}
                addressInfo={addressInfo}
              />
            ))}
          </div>
        </div>
      )}

      <div className="min-h-12" />
    </div>
  )
}

