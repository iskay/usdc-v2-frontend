/**
 * Forwarding Addresses Page
 * 
 * Displays all unique Noble forwarding addresses from the user's transaction history,
 * showing balances, registration status, and providing registration functionality.
 */

import { useState, useEffect, useCallback } from 'react'
import { BackToHome } from '@/components/common/BackToHome'
import { Spinner } from '@/components/common/Spinner'
import { ForwardingAddressCard, type ForwardingAddressInfo } from '@/components/forwarding/ForwardingAddressCard'
import { transactionStorageService, type StoredTransaction } from '@/services/tx/transactionStorageService'
import { logger } from '@/utils/logger'
import { env } from '@/config/env'

export function ForwardingAddresses() {
  const [addresses, setAddresses] = useState<ForwardingAddressInfo[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Extract unique forwarding addresses from transactions
  const extractAddresses = useCallback(() => {
    try {
      const allTxs = transactionStorageService.getAllTransactions()
      
      // Filter for deposit transactions
      const depositTxs = allTxs.filter((tx) => tx.direction === 'deposit')
      
      // Map to store unique addresses (key: forwardingAddress)
      const addressMap = new Map<string, {
        forwardingAddress: string
        recipientAddress: string
        transaction: StoredTransaction
        lastUsedTimestamp: number
        channelId?: string
        fallback?: string
      }>()

      depositTxs.forEach((tx) => {
        // Try multiple sources for forwarding address (depositData is primary, pollingState metadata is fallback)
        const forwardingAddress = 
          tx.depositData?.nobleForwardingAddress ||
          tx.pollingState?.metadata?.forwardingAddress as string | undefined
        
        // Try multiple sources for recipient address
        const recipientAddress = 
          tx.depositDetails?.destinationAddress ||
          tx.pollingState?.metadata?.namadaReceiver as string | undefined ||
          tx.pollingState?.metadata?.recipient as string | undefined
        
        if (forwardingAddress && recipientAddress) {
          // Get channel ID from transaction metadata or use default
          const channelId = 
            tx.pollingState?.chainStatus.noble?.metadata?.channelId as string | undefined ||
            tx.pollingState?.metadata?.channelId as string | undefined ||
            env.nobleToNamadaChannel()
          
          const fallback = tx.depositData?.fallback as string | undefined
          
          // Get transaction timestamp
          const txTimestamp = tx.updatedAt || tx.createdAt
          
          // Track both the primary transaction and the max timestamp across all transactions
          const existing = addressMap.get(forwardingAddress)
          if (!existing) {
            // First time seeing this address
            addressMap.set(forwardingAddress, {
              forwardingAddress,
              recipientAddress,
              transaction: tx,
              lastUsedTimestamp: txTimestamp,
              channelId,
              fallback,
            })
          } else {
            // Update lastUsedTimestamp to be the maximum across all transactions
            const maxTimestamp = Math.max(existing.lastUsedTimestamp, txTimestamp)
            
            // Also update the primary transaction if this one is more recent
            if (txTimestamp > (existing.transaction.updatedAt || existing.transaction.createdAt)) {
              existing.transaction = tx
            }
            
            // Always update lastUsedTimestamp to reflect the most recent usage
            existing.lastUsedTimestamp = maxTimestamp
          }
        }
      })

      const uniqueAddresses: ForwardingAddressInfo[] = Array.from(addressMap.values())
      
      // Sort by most recent transaction first
      uniqueAddresses.sort((a, b) => {
        const aTime = a.transaction.updatedAt || a.transaction.createdAt
        const bTime = b.transaction.updatedAt || b.transaction.createdAt
        return bTime - aTime
      })

      setAddresses(uniqueAddresses)
      setIsLoading(false)
      setError(null)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load forwarding addresses'
      logger.error('[ForwardingAddresses] Failed to extract addresses', {
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
      <BackToHome />

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Forwarding Addresses</h1>
        <p className="text-muted-foreground">
          Manage your Noble forwarding addresses from deposit transactions. View balances, check registration status, and register addresses as needed.
        </p>
      </header>

      {/* Loading State */}
      {isLoading && (
        <div className="rounded-lg border border-border bg-card p-12 shadow-sm">
          <div className="flex items-center justify-center">
            <Spinner label="Loading forwarding addresses..." />
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
            No forwarding addresses found. Forwarding addresses will appear here after you make deposit transactions.
          </p>
        </div>
      )}

      {/* Addresses List */}
      {!isLoading && !error && addresses.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Found {addresses.length} unique forwarding address{addresses.length !== 1 ? 'es' : ''}
            </p>
          </div>
          
          <div className="space-y-4">
            {addresses.map((addressInfo) => (
              <ForwardingAddressCard
                key={addressInfo.forwardingAddress}
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

