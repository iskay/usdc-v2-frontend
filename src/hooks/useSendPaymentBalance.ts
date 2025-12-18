import { useAtomValue } from 'jotai'
import { useBalance } from '@/hooks/useBalance'
import { useShieldedSync } from '@/hooks/useShieldedSync'
import { balanceSyncAtom, balanceErrorsAtom } from '@/atoms/balanceAtom'
import { checkBalanceError, formatBalanceForDisplay, isBalanceLoading } from '@/utils/balanceHelpers'

export interface UseSendPaymentBalanceReturn {
  shieldedBalance: string
  isShieldedBalanceLoading: boolean
  hasBalanceError: boolean
}

/**
 * Hook to manage shielded balance state for send payment flow
 */
export function useSendPaymentBalance(): UseSendPaymentBalanceReturn {
  const { state: balanceState } = useBalance()
  const { state: shieldedState } = useShieldedSync()
  const balanceSyncState = useAtomValue(balanceSyncAtom)
  const balanceErrors = useAtomValue(balanceErrorsAtom)

  // Check for balance calculation error state
  const hasBalanceError = checkBalanceError(balanceSyncState, balanceErrors, 'shielded')
  const shieldedBalanceValue = balanceState.namada.usdcShielded
  const shieldedBalance = formatBalanceForDisplay(shieldedBalanceValue, hasBalanceError)
  const isShieldedBalanceLoading = isBalanceLoading(
    balanceSyncState,
    'shielded',
    shieldedState.isSyncing
  )

  return {
    shieldedBalance,
    isShieldedBalanceLoading,
    hasBalanceError,
  }
}

