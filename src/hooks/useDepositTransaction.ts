import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAtom } from 'jotai'
import { useTxTracker } from '@/hooks/useTxTracker'
import { useToast } from '@/hooks/useToast'
import { txUiAtom } from '@/atoms/txUiAtom'
import {
  buildDepositTransaction,
  signDepositTransaction,
  broadcastDepositTransaction,
  saveDepositTransaction,
  type DepositTransactionDetails,
} from '@/services/deposit/depositService'
import { transactionStorageService, type StoredTransaction } from '@/services/tx/transactionStorageService'
import {
  buildTransactionSuccessToast,
  buildTransactionErrorToast,
  buildTransactionStatusToast,
  buildCopySuccessToast,
} from '@/utils/toastHelpers'
import { getEvmTxExplorerUrl } from '@/utils/explorerUtils'
import { sanitizeError } from '@/utils/errorSanitizer'

export interface UseDepositTransactionParams {
  amount: string
  toAddress: string
  selectedChain: string
  chainName: string
  estimatedFee: string
  total: string
  evmAddress: string | undefined
  onAddressBookSave?: () => void
}

export interface UseDepositTransactionReturn {
  submitDeposit: (params: UseDepositTransactionParams) => Promise<void>
}

/**
 * Hook to handle deposit transaction submission
 */
export function useDepositTransaction(): UseDepositTransactionReturn {
  const navigate = useNavigate()
  const { upsertTransaction } = useTxTracker({ enablePolling: false })
  const { notify, updateToast, dismissToast } = useToast()
  const [txUiState, setTxUiState] = useAtom(txUiAtom)

  const submitDeposit = useCallback(async (params: UseDepositTransactionParams): Promise<void> => {
    const { amount, toAddress, selectedChain, chainName, estimatedFee, total, evmAddress, onAddressBookSave } = params

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
      transactionType: 'deposit',
    })

    // Track transaction state for error handling
    let tx: Awaited<ReturnType<typeof buildDepositTransaction>> | undefined
    let signedTx: Awaited<ReturnType<typeof signDepositTransaction>> | undefined
    let currentTx: StoredTransaction | undefined

    // Use a consistent toast ID for transaction status updates
    const txToastId = `deposit-tx-${Date.now()}`

    try {
      // Build transaction details
      const transactionDetails: DepositTransactionDetails = {
        amount,
        fee: estimatedFee,
        total,
        destinationAddress: toAddress,
        chainName,
        ...(evmAddress && { senderAddress: evmAddress }),
      }

      // Build transaction
      notify(buildTransactionStatusToast('building', 'deposit', txToastId))
      tx = await buildDepositTransaction({
        amount,
        destinationAddress: toAddress,
        sourceChain: selectedChain,
      })

      // Save transaction immediately after build (for error tracking)
      currentTx = {
        ...tx,
        depositDetails: transactionDetails,
        updatedAt: Date.now(),
      }
      transactionStorageService.saveTransaction(currentTx)
      upsertTransaction(tx)

      // Sign transaction (no-op, actual signing happens during broadcast)
      setTxUiState({ ...txUiState, phase: 'signing' })
      updateToast(txToastId, buildTransactionStatusToast('signing', 'deposit'))
      signedTx = await signDepositTransaction(tx)

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

      const txHashResult = await broadcastDepositTransaction(signedTx, {
        onSigningComplete: () => {
          // Phase 3: Submitting (only after signing is complete)
          setTxUiState({ ...txUiState, phase: 'submitting' })
          updateToast(txToastId, buildTransactionStatusToast('submitting', 'deposit'))
        },
      })

      const txHash = txHashResult

      // Update transaction with hash
      const txWithHash = {
        ...signedTx,
        hash: txHash,
        status: 'broadcasted' as const,
      }

      // Save transaction to unified storage with deposit details
      // Frontend polling handles all tracking (no backend registration needed)
      const savedTx = await saveDepositTransaction(txWithHash, transactionDetails)

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
      if (selectedChain) {
        getEvmTxExplorerUrl(selectedChain, txHash).then((url) => {
          setTxUiState((prev) => ({ ...prev, explorerUrl: url }))
        }).catch(() => {
          // Silently fail if explorer URL can't be fetched
        })
      }
    } catch (error) {
      // Dismiss the loading toast if it exists
      dismissToast(txToastId)

      console.error('[useDepositTransaction] Deposit submission failed:', error)
      const sanitized = sanitizeError(error)
      const message = sanitized.message

      // Save error transaction to storage for history tracking
      try {
        // Build transaction details for error case
        const transactionDetails: DepositTransactionDetails = {
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
            direction: 'deposit',
            status: 'error',
            errorMessage: message,
            depositDetails: transactionDetails,
          }

        transactionStorageService.saveTransaction(errorTx)
        upsertTransaction(errorTx)
      } catch (saveError) {
        console.error('[useDepositTransaction] Failed to save error transaction:', saveError)
      }

      // Show error toast with action to view transaction if available
      const errorTxForToast = currentTx || (tx ? { id: tx.id, direction: 'deposit' as const } : undefined)
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
          title: 'Deposit Failed',
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
    submitDeposit,
  }
}

