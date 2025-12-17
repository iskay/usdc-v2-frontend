import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAtom } from 'jotai'
import { useTxTracker } from '@/hooks/useTxTracker'
import { useToast } from '@/hooks/useToast'
import { txUiAtom } from '@/atoms/txUiAtom'
import {
  buildPaymentTransaction,
  signPaymentTransaction,
  broadcastPaymentTransaction,
  savePaymentTransaction,
  type PaymentTransactionDetails,
} from '@/services/payment/paymentService'
import { transactionStorageService, type StoredTransaction } from '@/services/tx/transactionStorageService'
import {
  buildTransactionSuccessToast,
  buildTransactionErrorToast,
  buildTransactionStatusToast,
  buildCopySuccessToast,
} from '@/utils/toastHelpers'
import { getNamadaTxExplorerUrl } from '@/utils/explorerUtils'
import { sanitizeError } from '@/utils/errorSanitizer'

export interface UsePaymentTransactionParams {
  amount: string
  toAddress: string
  selectedChain: string
  chainName: string
  estimatedFee: string
  total: string
  transparentAddress: string
  shieldedAddress: string | undefined
  isShieldedSyncing: boolean
  onAddressBookSave?: () => void
}

export interface UsePaymentTransactionReturn {
  submitPayment: (params: UsePaymentTransactionParams) => Promise<void>
}

/**
 * Hook to handle payment transaction submission
 */
export function usePaymentTransaction(): UsePaymentTransactionReturn {
  const navigate = useNavigate()
  const { upsertTransaction } = useTxTracker({ enablePolling: false })
  const { notify, updateToast, dismissToast } = useToast()
  const [txUiState, setTxUiState] = useAtom(txUiAtom)

  const submitPayment = useCallback(async (params: UsePaymentTransactionParams): Promise<void> => {
    const {
      amount,
      toAddress,
      selectedChain,
      chainName,
      estimatedFee,
      total,
      transparentAddress,
      shieldedAddress,
      isShieldedSyncing,
      onAddressBookSave,
    } = params

    // Save address to address book immediately on initiation (non-blocking)
    if (onAddressBookSave) {
      void onAddressBookSave()
    }

    setTxUiState({
      ...txUiState,
      isSubmitting: true,
      phase: 'building',
      errorState: null,
      txHash: null,
      explorerUrl: undefined,
      showSuccessState: false,
      transactionType: 'send',
    })

    // Track transaction state for error handling
    let tx: Awaited<ReturnType<typeof buildPaymentTransaction>> | undefined
    let signedTx: Awaited<ReturnType<typeof signPaymentTransaction>> | undefined
    let currentTx: StoredTransaction | undefined

    // Use a consistent toast ID for transaction status updates
    const txToastId = `payment-tx-${Date.now()}`

    try {
      // Build transaction details
      const transactionDetails: PaymentTransactionDetails = {
        amount,
        fee: estimatedFee,
        total,
        destinationAddress: toAddress,
        chainName,
      }

      if (!transparentAddress) {
        throw new Error('Namada transparent address not found. Please connect your Namada Keychain.')
      }

      // Show sync status if sync is happening
      if (isShieldedSyncing) {
        notify({
          title: 'Syncing shielded balance...',
          description: 'Please wait while we update your shielded context',
          level: 'info',
        })
      }

      // Build transaction (this will ensure sync completes before building)
      notify(buildTransactionStatusToast('building', 'send', txToastId))
      tx = await buildPaymentTransaction({
        amount,
        destinationAddress: toAddress,
        destinationChain: selectedChain,
        transparentAddress,
        shieldedAddress,
      })

      // Save transaction immediately after build (for error tracking)
      currentTx = {
        ...tx,
        paymentDetails: transactionDetails,
        updatedAt: Date.now(),
      }
      transactionStorageService.saveTransaction(currentTx)
      upsertTransaction(tx)

      // Sign transaction (no-op, actual signing happens during broadcast)
      setTxUiState({ ...txUiState, phase: 'signing' })
      updateToast(txToastId, buildTransactionStatusToast('signing', 'send'))
      signedTx = await signPaymentTransaction(tx)

      // Update status to signing
      currentTx = {
        ...currentTx,
        ...signedTx,
        status: 'signing',
        updatedAt: Date.now(),
      }
      transactionStorageService.saveTransaction(currentTx)
      upsertTransaction(signedTx)

      // Broadcast transaction (signing popup appears here, so keep showing "Signing transaction...")
      // Update status to submitting after signing completes
      currentTx = {
        ...currentTx,
        status: 'submitting',
        updatedAt: Date.now(),
      }
      transactionStorageService.saveTransaction(currentTx)

      const broadcastResult = await broadcastPaymentTransaction(signedTx, {
        onSigningComplete: () => {
          // Phase 3: Submitting (only after signing is complete)
          setTxUiState({ ...txUiState, phase: 'submitting' })
          updateToast(txToastId, buildTransactionStatusToast('submitting', 'send'))
        },
      })
      const txHash = broadcastResult.hash
      const blockHeight = broadcastResult.blockHeight

      // Update transaction with hash and block height
      const txWithHash = {
        ...signedTx,
        hash: txHash,
        blockHeight,
        status: 'broadcasted' as const,
      }

      // Save transaction to unified storage with payment details
      // Frontend polling handles all tracking (no backend registration needed)
      const savedTx = await savePaymentTransaction(txWithHash, transactionDetails)

      // Also update in-memory state for immediate UI updates
      upsertTransaction(savedTx)

      // Update the existing loading toast to success toast
      const successToast = buildTransactionSuccessToast(savedTx, {
        onViewTransaction: (id) => {
          navigate(`/dashboard?tx=${id}`)
        },
        onCopyHash: () => {
          notify(buildCopySuccessToast('Transaction hash'))
        },
      })
      const { id: _, ...successToastArgs } = successToast
      updateToast(txToastId, successToastArgs)

      // Set success state and fetch explorer URL
      setTxUiState({ ...txUiState, phase: null, txHash, showSuccessState: true })
      getNamadaTxExplorerUrl(txHash).then((url) => {
        setTxUiState((prev) => ({ ...prev, explorerUrl: url }))
      }).catch(() => {
        // Silently fail if explorer URL can't be fetched
      })
    } catch (error) {
      // Dismiss the loading toast if it exists
      dismissToast(txToastId)

      console.error('[usePaymentTransaction] Payment submission failed:', error)
      const sanitized = sanitizeError(error)
      const message = sanitized.message

      // Save error transaction to storage for history tracking
      try {
        // Build transaction details for error case
        const transactionDetails: PaymentTransactionDetails = {
          amount,
          fee: estimatedFee,
          total,
          destinationAddress: toAddress,
          chainName,
        }

        // Use current transaction state if available, otherwise create new error transaction
        const errorTx: StoredTransaction = currentTx
          ? {
            ...currentTx,
            status: 'error',
            errorMessage: message,
            updatedAt: Date.now(),
          }
          : {
            id: tx?.id || crypto.randomUUID(),
            createdAt: tx?.createdAt || Date.now(),
            updatedAt: Date.now(),
            chain: tx?.chain || selectedChain || '',
            direction: 'send',
            status: 'error',
            errorMessage: message,
            paymentDetails: transactionDetails,
          }

        transactionStorageService.saveTransaction(errorTx)
        upsertTransaction(errorTx)
      } catch (saveError) {
        console.error('[usePaymentTransaction] Failed to save error transaction:', saveError)
      }

      // Show error toast with action to view transaction if available
      const errorTxForToast = currentTx || (tx ? { id: tx.id, direction: 'send' as const } : undefined)
      if (errorTxForToast) {
        notify(
          buildTransactionErrorToast(errorTxForToast, message, {
            onViewTransaction: (id) => {
              navigate(`/dashboard?tx=${id}`)
            },
          })
        )
      } else {
        notify({
          title: 'Payment Failed',
          description: message,
          level: 'error',
        })
      }

      // Set error state for enhanced error display
      setTxUiState({ ...txUiState, errorState: { message }, phase: null, isSubmitting: false })
    } finally {
      // Reset isSubmitting in global state if not already reset
      if (txUiState.isSubmitting) {
        setTxUiState((prev) => ({ ...prev, isSubmitting: false }))
      }
    }
  }, [navigate, upsertTransaction, notify, updateToast, dismissToast, txUiState, setTxUiState])

  return {
    submitPayment,
  }
}

