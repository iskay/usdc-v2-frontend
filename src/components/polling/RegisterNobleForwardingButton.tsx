/**
 * Register Noble Forwarding Button Component
 * 
 * Button component for manually triggering Noble forwarding registration.
 * Can be used in transaction modals or elsewhere in the app.
 */

import { useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { useToast } from '@/hooks/useToast'
import { logger } from '@/utils/logger'
import { cn } from '@/lib/utils'
import {
  executeRegistrationJob,
  type NobleForwardingRegistrationJobParams,
} from '@/services/polling/nobleForwardingRegistration'

export interface RegisterNobleForwardingButtonProps {
  /** Transaction ID (optional, for flow context) */
  txId?: string
  /** Noble forwarding address */
  forwardingAddress: string
  /** Namada recipient address */
  recipientAddress: string
  /** IBC channel ID (optional) */
  channelId?: string
  /** Fallback address (optional) */
  fallback?: string
  /** Callback when registration completes */
  onRegistrationComplete?: (result: { success: boolean; txHash?: string; error?: string }) => void
  /** Button variant */
  variant?: 'default' | 'outline' | 'ghost'
  /** Button size */
  size?: 'sm' | 'md' | 'lg'
  /** Additional className */
  className?: string
}

/**
 * Register Noble Forwarding Button
 * 
 * Triggers Noble forwarding registration job when clicked.
 * Shows loading state during registration attempt.
 */
export function RegisterNobleForwardingButton({
  txId,
  forwardingAddress,
  recipientAddress,
  channelId,
  fallback,
  onRegistrationComplete,
  variant = 'default',
  size = 'sm',
  className,
}: RegisterNobleForwardingButtonProps) {
  const [isRegistering, setIsRegistering] = useState(false)
  const { notify } = useToast()

  const handleClick = async () => {
    setIsRegistering(true)

    try {
      logger.info('[RegisterNobleForwardingButton] Triggering registration', {
        txId,
        forwardingAddress: forwardingAddress.slice(0, 16) + '...',
        recipientAddress: recipientAddress.slice(0, 16) + '...',
      })

      const params: NobleForwardingRegistrationJobParams = {
        txId,
        forwardingAddress,
        recipientAddress,
        channelId,
        fallback,
      }

      const result = await executeRegistrationJob(params)

      if (result.success) {
        if (result.alreadyRegistered) {
          notify({
            title: 'Already Registered',
            description: 'Noble forwarding address is already registered.',
            level: 'info',
          })
        } else {
          notify({
            title: 'Registration Successful',
            description: result.registrationTx.txHash
              ? `Registration transaction submitted: ${result.registrationTx.txHash.slice(0, 16)}...`
              : 'Noble forwarding registration completed.',
            level: 'success',
          })
        }

        onRegistrationComplete?.({
          success: true,
          txHash: result.registrationTx.txHash,
        })
      } else {
        const errorMessage = result.metadata.errorMessage || 'Registration failed'
        
        notify({
          title: 'Registration Failed',
          description: errorMessage,
          level: 'error',
        })

        onRegistrationComplete?.({
          success: false,
          error: errorMessage,
        })
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      logger.error('[RegisterNobleForwardingButton] Registration failed', {
        txId,
        error: errorMessage,
      })

      notify({
        title: 'Registration Failed',
        description: errorMessage,
        level: 'error',
      })

      onRegistrationComplete?.({
        success: false,
        error: errorMessage,
      })
    } finally {
      setIsRegistering(false)
    }
  }

  const sizeClasses = {
    sm: 'px-2 py-1 text-xs',
    md: 'px-3 py-1.5 text-sm',
    lg: 'px-4 py-2 text-base',
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isRegistering}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md font-medium transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        sizeClasses[size],
        variant === 'default' && 'bg-primary text-primary-foreground hover:bg-primary/90',
        variant === 'outline' && 'border border-border bg-background hover:bg-muted',
        variant === 'ghost' && 'hover:bg-muted',
        className,
      )}
      aria-label="Register Noble forwarding address"
    >
      {isRegistering ? (
        <>
          <Loader2 className={cn(
            'h-3 w-3',
            size === 'lg' && 'h-4 w-4',
            'animate-spin',
          )} />
          <span>Registering...</span>
        </>
      ) : (
        <>
          <RefreshCw className={cn(
            'h-3 w-3',
            size === 'lg' && 'h-4 w-4',
          )} />
          <span>Register Forwarding Address</span>
        </>
      )}
    </button>
  )
}

