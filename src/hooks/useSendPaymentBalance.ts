import { useAtomValue } from 'jotai'
import { useBalance } from '@/hooks/useBalance'
import { useShieldedSync } from '@/hooks/useShieldedSync'
import { balanceSyncAtom, balanceErrorAtom } from '@/atoms/balanceAtom'

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
  const balanceError = useAtomValue(balanceErrorAtom)

  // Check for balance calculation error state
  const hasBalanceError = balanceSyncState.shieldedStatus === 'error' && !!balanceError
  const shieldedBalance = hasBalanceError ? '--' : (balanceState.namada.usdcShielded || '--')
  const isShieldedBalanceLoading =
    shieldedState.isSyncing || balanceSyncState.shieldedStatus === 'calculating'

  return {
    shieldedBalance,
    isShieldedBalanceLoading,
    hasBalanceError,
  }
}

