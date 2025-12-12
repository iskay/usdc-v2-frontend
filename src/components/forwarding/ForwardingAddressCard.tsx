/**
 * Forwarding Address Card Component
 * 
 * Displays a single Noble forwarding address with its details,
 * balance, registration status, and registration button.
 */

import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { AddressDisplay } from '@/components/common/AddressDisplay'
import { getNobleUusdcBalance } from '@/services/noble/nobleLcdClient'
import { isNobleForwardingRegistered } from '@/services/polling/nobleForwardingRegistration'
import { RegisterNobleForwardingButton } from '@/components/polling/RegisterNobleForwardingButton'
import { getNobleTxExplorerUrl } from '@/utils/explorerUtils'
import { env } from '@/config/env'
import { logger } from '@/utils/logger'
import type { StoredTransaction } from '@/services/tx/transactionStorageService'
import { checkNobleForwardingRegistration } from '@/services/deposit/nobleForwardingService'

export interface ForwardingAddressInfo {
  forwardingAddress: string
  recipientAddress: string
  transaction: StoredTransaction
  lastUsedTimestamp: number
  channelId?: string
  fallback?: string
}

interface ForwardingAddressCardProps {
  addressInfo: ForwardingAddressInfo
}

export function ForwardingAddressCard({ addressInfo }: ForwardingAddressCardProps) {
  const { forwardingAddress, recipientAddress, transaction, lastUsedTimestamp, channelId, fallback } = addressInfo
  
  const [balance, setBalance] = useState<string | null>(null)
  const [isBalanceLoading, setIsBalanceLoading] = useState(true)
  const [isRegistered, setIsRegistered] = useState<boolean | null>(null)
  const [isRegistrationCheckLoading, setIsRegistrationCheckLoading] = useState(true)
  const [registrationError, setRegistrationError] = useState<string | null>(null)
  const [registrationTxHash, setRegistrationTxHash] = useState<string | undefined>()
  const [explorerUrl, setExplorerUrl] = useState<string | undefined>()

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
        const balanceUusdc = await getNobleUusdcBalance(forwardingAddress)
        if (cancelled) return
        
        // Format balance (uusdc has 6 decimals)
        const formatted = (Number(balanceUusdc) / 1_000_000).toFixed(6)
        setBalance(formatted)
      } catch (error) {
        if (cancelled) return
        logger.error('[ForwardingAddressCard] Failed to fetch balance', {
          forwardingAddress: forwardingAddress.slice(0, 16) + '...',
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
  }, [forwardingAddress])

  // Check registration status
  useEffect(() => {
    let cancelled = false

    async function checkRegistration() {
      setIsRegistrationCheckLoading(true)
      setRegistrationError(null)
      try {
        const channel = channelId || env.nobleToNamadaChannel()
        const status = await checkNobleForwardingRegistration(recipientAddress, channel, fallback || '')

        if (cancelled) return

        if (status.error) {
          setIsRegistered(null)
          setRegistrationError(
            status.error || 'Could not query registration status. Please try again.',
          )
        } else {
          setIsRegistered(status.exists)
        }
      } catch (error) {
        if (cancelled) return
        logger.error('[ForwardingAddressCard] Failed to check registration status', {
          forwardingAddress: forwardingAddress.slice(0, 16) + '...',
          error: error instanceof Error ? error.message : String(error),
        })
        setIsRegistered(null)
        setRegistrationError('Could not query registration status. Please check your network.')
      } finally {
        if (!cancelled) {
          setIsRegistrationCheckLoading(false)
        }
      }
    }

    checkRegistration()
    return () => {
      cancelled = true
    }
  }, [forwardingAddress, recipientAddress, channelId])

  // Handle registration completion
  const handleRegistrationComplete = async (result: { success: boolean; txHash?: string; error?: string }) => {
    if (result.success && result.txHash) {
      setRegistrationTxHash(result.txHash)
      // Fetch explorer URL
      const url = await getNobleTxExplorerUrl(result.txHash)
      setExplorerUrl(url)
      // Re-check registration status after a short delay
      setTimeout(async () => {
        try {
          const channel = channelId || env.nobleToNamadaChannel()
          const registered = await isNobleForwardingRegistered(
            forwardingAddress,
            channel,
            recipientAddress,
            fallback || ''
          )
          setIsRegistered(registered)
        } catch (error) {
          logger.error('[ForwardingAddressCard] Failed to re-check registration after completion', { error })
        }
      }, 2000)
    }
  }

  return (
    <div className="card card-lg">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Forwarding Address */}
        <div className="space-y-1">
          <dt className="text-sm font-medium text-muted-foreground">Noble Forwarding Address</dt>
          <dd>
            <AddressDisplay
              value={forwardingAddress}
              label="Forwarding address"
              format="medium"
              size="md"
            />
          </dd>
        </div>

        {/* Recipient Address */}
        <div className="space-y-1">
          <dt className="text-sm font-medium text-muted-foreground">Namada Recipient Address</dt>
          <dd>
            <AddressDisplay
              value={recipientAddress}
              label="Recipient address"
              format="medium"
              size="md"
            />
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

        {/* Registration Status */}
        <div className="space-y-1">
          <dt className="text-sm font-medium text-muted-foreground">Registration Status</dt>
          <dd>
            {isRegistrationCheckLoading ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Checking...</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {registrationError ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning">
                    <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                    Status unavailable
                  </span>
                ) : isRegistered === true ? (
                  <>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-medium text-success">
                      <span className="h-1.5 w-1.5 rounded-full bg-success" />
                      Registered
                    </span>
                  </>
                ) : isRegistered === false ? (
                  <>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning">
                      <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                      Not Registered
                    </span>
                  </>
                ) : (
                  <span className="text-sm text-muted-foreground">Unknown</span>
                )}
              </div>
            )}
          </dd>
          {registrationError && (
            <p className="text-xs text-muted-foreground mt-1">
              {registrationError}
            </p>
          )}
        </div>
      </div>

      {/* Registration Button and Transaction Hash - Full Width */}
      {( (!isRegistrationCheckLoading && isRegistered === false) || registrationTxHash ) && (
      <div className="mt-6 pt-6 border-t border-border space-y-4">
        {/* Registration Button */}
        {!isRegistrationCheckLoading && isRegistered === false && (
          <div className="space-y-2">
            <RegisterNobleForwardingButton
              txId={transaction.id}
              forwardingAddress={forwardingAddress}
              recipientAddress={recipientAddress}
              channelId={channelId}
              fallback={fallback}
              onRegistrationComplete={handleRegistrationComplete}
              variant="default"
              size="sm"
            />
            <p className="text-xs text-muted-foreground">
              A 0.02 USDC tx fee will be deducted from this account's balance
            </p>
          </div>
        )}

        {/* Registration Transaction Hash */}
        {registrationTxHash && (
          <div className="space-y-1">
            <dt className="text-sm font-medium text-muted-foreground">Registration Transaction</dt>
            <dd>
              <AddressDisplay
                value={registrationTxHash}
                explorerUrl={explorerUrl}
                label="Registration transaction"
                format="medium"
                size="sm"
              />
            </dd>
          </div>
        )}
      </div>
      )}

      {/* Last Used Date */}
      <div className="mt-4 pt-3 border-t border-border">
        <p className="text-xs text-muted-foreground">
          {formatLastUsedDate(lastUsedTimestamp)}
        </p>
      </div>
    </div>
  )
}

