import { useCallback } from 'react'
import { useAtom } from 'jotai'
import { txAtom } from '@/atoms/txAtom'
import type { TrackedTransaction, TxStatusMessage } from '@/types/tx'

export function useTxTracker() {
  const [txState, setTxState] = useAtom(txAtom)

  const upsertTransaction = useCallback(
    (input: TrackedTransaction) => {
      setTxState((state) => {
        const history = state.history.filter((item) => item.id !== input.id)
        return { ...state, activeTransaction: input, history: [input, ...history] }
      })
    },
    [setTxState],
  )

  const applyStatusMessage = useCallback(
    (message: TxStatusMessage) => {
      // TODO: Merge backend status updates with local transaction history.
      setTxState((state) => ({
        ...state,
        activeTransaction:
          state.activeTransaction && state.activeTransaction.id === message.txId
            ? { ...state.activeTransaction, status: message.stage, errorMessage: undefined }
            : state.activeTransaction,
      }))
    },
    [setTxState],
  )

  const clearActive = useCallback(() => {
    setTxState((state) => ({ ...state, activeTransaction: undefined }))
  }, [setTxState])

  return { state: txState, upsertTransaction, applyStatusMessage, clearActive }
}
