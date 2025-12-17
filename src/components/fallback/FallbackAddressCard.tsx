/**
 * Fallback Address Card Component
 * 
 * Displays a single Noble fallback address with its associated EVM address
 * and USDC balance.
 */

import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { AddressDisplay } from '@/components/common/AddressDisplay'
import { getNobleUusdcBalance } from '@/services/noble/nobleLcdClient'
import { logger } from '@/utils/logger'

export interface FallbackAddressInfo {
  fallbackAddress: string
  evmAddress: string | null
  lastUsedTimestamp: number
}

interface FallbackAddressCardProps {
  addressInfo: FallbackAddressInfo
}

export function FallbackAddressCard({ addressInfo }: FallbackAddressCardProps) {
  const { fallbackAddress, evmAddress, lastUsedTimestamp } = addressInfo
  
  const [balance, setBalance] = useState<string | null>(null)
  const [isBalanceLoading, setIsBalanceLoading] = useState(true)

  // Format last used date
  const formatLastUsedDate = (timestamp: number): string => {
    const date = new Date(timestamp)
    return `Last used ${date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    })}`
  }

  // Fetch balance
  useEffect(() => {
    let cancelled = false

    async function fetchBalance() {
      setIsBalanceLoading(true)
      try {
        const balanceUusdc = await getNobleUusdcBalance(fallbackAddress)
        if (cancelled) return
        
        // Format balance (uusdc has 6 decimals)
        const formatted = (Number(balanceUusdc) / 1_000_000).toFixed(6)
        setBalance(formatted)
      } catch (error) {
        if (cancelled) return
        logger.error('[FallbackAddressCard] Failed to fetch balance', {
          fallbackAddress: fallbackAddress.slice(0, 16) + '...',
          error: error instanceof Error ? error.message : String(error),
        })
        setBalance('--')
      } finally {
        if (!cancelled) {
          setIsBalanceLoading(false)
        }
      }
    }

    fetchBalance()
    return () => {
      cancelled = true
    }
  }, [fallbackAddress])

  return (
    <div className="card card-lg">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {/* Fallback Address */}
        <div className="space-y-1">
          <dt className="text-sm font-medium text-muted-foreground">Noble Fallback Address</dt>
          <dd>
            <AddressDisplay
              value={fallbackAddress}
              label="Fallback address"
              format="medium"
              size="md"
            />
          </dd>
        </div>

        {/* Associated EVM Address */}
        <div className="space-y-1">
          <dt className="text-sm font-medium text-muted-foreground">Associated EVM Address</dt>
          <dd>
            {evmAddress ? (
              <AddressDisplay
                value={evmAddress}
                label="EVM address"
                format="medium"
                size="md"
              />
            ) : (
              <span className="text-sm text-muted-foreground">N/A</span>
            )}
          </dd>
        </div>

        {/* USDC Balance */}
        <div className="space-y-1">
          <dt className="text-sm font-medium text-muted-foreground">USDC Balance</dt>
          <dd>
            {isBalanceLoading ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Loading...</span>
              </div>
            ) : (
              <span className="text-sm font-medium">
                {balance === '--' ? (
                  <span className="text-muted-foreground">--</span>
                ) : (
                  `${balance} USDC`
                )}
              </span>
            )}
          </dd>
        </div>
      </div>

      {/* Last Used Date */}
      <div className="mt-4 pt-3 border-t border-border">
        <p className="text-xs text-muted-foreground">
          {formatLastUsedDate(lastUsedTimestamp)}
        </p>
      </div>
    </div>
  )
}

