import { useState, useEffect, useRef } from 'react'
import { useAtomValue } from 'jotai'
import { validateNamadaAddress } from '@/services/validation'
import { checkCurrentDepositRecipientRegistration } from '@/services/deposit/nobleForwardingService'
import { depositFallbackSelectionAtom } from '@/atoms/appAtom'

export interface RegistrationStatus {
  isLoading: boolean
  isRegistered: boolean | null
  forwardingAddress: string | null
  error: string | null
}

/**
 * Hook to manage Noble forwarding registration status checking
 * Debounces address changes and checks registration status
 */
export function useNobleRegistrationStatus(recipientAddress: string): RegistrationStatus {
  const depositFallbackSelection = useAtomValue(depositFallbackSelectionAtom)
  const [status, setStatus] = useState<RegistrationStatus>({
    isLoading: false,
    isRegistered: null,
    forwardingAddress: null,
    error: null,
  })

  // Track the current address being checked to prevent race conditions
  const checkingAddressRef = useRef<string | null>(null)

  useEffect(() => {
    // Only check if address is valid
    const addressValidation = validateNamadaAddress(recipientAddress)
    if (!addressValidation.isValid || !addressValidation.value) {
      // Reset status if address is invalid
      checkingAddressRef.current = null
      setStatus({
        isLoading: false,
        isRegistered: null,
        forwardingAddress: null,
        error: null,
      })
      return
    }

    const addressToCheck = addressValidation.value
    checkingAddressRef.current = addressToCheck

    // Debounce the check
    const timeoutId = setTimeout(async () => {
      // Double-check that we're still checking the same address
      if (checkingAddressRef.current !== addressToCheck) {
        return
      }

      setStatus({
        isLoading: true,
        isRegistered: null,
        forwardingAddress: null,
        error: null,
      })

      try {
        const fallback = depositFallbackSelection.address || ''

        // If fallback address is not available, we can't check registration status
        // In this case, assume registration fee is needed
        if (!fallback) {
          if (checkingAddressRef.current === addressToCheck) {
            setStatus({
              isLoading: false,
              isRegistered: null, // Unknown status
              forwardingAddress: null,
              error: 'Fallback address not yet derived. Registration fee will be included.',
            })
          }
          return
        }

        const registrationStatus = await checkCurrentDepositRecipientRegistration(addressToCheck, undefined, fallback)

        // Only update if we're still checking the same address
        if (checkingAddressRef.current === addressToCheck) {
          setStatus({
            isLoading: false,
            isRegistered: registrationStatus.error ? null : registrationStatus.exists,
            forwardingAddress: registrationStatus.address || null,
            error: registrationStatus.error || null,
          })
        }
      } catch (error) {
        // Only update if we're still checking the same address
        if (checkingAddressRef.current !== addressToCheck) {
          return
        }

        // Don't show error if it's just that no address is available
        const errorMessage = error instanceof Error ? error.message : String(error)
        if (errorMessage.includes('No deposit recipient address')) {
          setStatus({
            isLoading: false,
            isRegistered: null,
            forwardingAddress: null,
            error: null,
          })
        } else {
          setStatus({
            isLoading: false,
            isRegistered: null,
            forwardingAddress: null,
            error: errorMessage,
          })
        }
      }
    }, 500) // 500ms debounce

    return () => {
      clearTimeout(timeoutId)
      // Clear the ref if the effect is cleaning up due to address change
      if (checkingAddressRef.current === addressToCheck) {
        checkingAddressRef.current = null
      }
    }
  }, [recipientAddress, depositFallbackSelection.address])

  return status
}

