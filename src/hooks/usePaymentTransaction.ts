import { useTransactionSubmission } from '@/hooks/useTransactionSubmission'
import { useToast } from '@/hooks/useToast'
import {
  buildPaymentTransaction,
  signPaymentTransaction,
  broadcastPaymentTransaction,
  savePaymentTransaction,
  type PaymentTransactionDetails,
} from '@/services/payment/paymentService'
import { getNamadaTxExplorerUrl } from '@/utils/explorerUtils'

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
  const { notify } = useToast()

  const { submit } = useTransactionSubmission<
    Omit<UsePaymentTransactionParams, 'onAddressBookSave' | 'isShieldedSyncing'>,
    PaymentTransactionDetails
  >({
    transactionType: 'send',
    direction: 'send',
    buildTransaction: async (txParams) => {
      if (!txParams.transparentAddress) {
        throw new Error('Namada transparent address not found. Please connect your Namada Keychain.')
      }

      return await buildPaymentTransaction({
        amount: txParams.amount,
        destinationAddress: txParams.toAddress,
        destinationChain: txParams.selectedChain,
        transparentAddress: txParams.transparentAddress,
        shieldedAddress: txParams.shieldedAddress,
      })
    },
    signTransaction: signPaymentTransaction,
    broadcastTransaction: broadcastPaymentTransaction,
    saveTransaction: savePaymentTransaction,
    getExplorerUrl: async (_chain: string | undefined, hash: string) => {
      const url = await getNamadaTxExplorerUrl(hash)
      return url || ''
    },
    onBeforeSubmit: async () => {
      // Note: isShieldedSyncing is not available here, so we'll handle it in submitPayment
      // This is a limitation of the generic hook - we need to handle it at the wrapper level
    },
  })

  const submitPayment = async (params: UsePaymentTransactionParams): Promise<void> => {
    const { isShieldedSyncing, onAddressBookSave, ...rest } = params
    const details: PaymentTransactionDetails = {
      amount: params.amount,
      fee: params.estimatedFee,
      total: params.total,
      destinationAddress: params.toAddress,
      chainName: params.chainName,
    }

    // Show sync status if sync is happening
    if (isShieldedSyncing) {
      notify({
        title: 'Syncing shielded balance...',
        description: 'Please wait while we update your shielded context',
        level: 'info',
      })
    }

    await submit({
      ...rest,
      details,
      onAddressBookSave,
    })
  }

  return {
    submitPayment,
  }
}

