import type { TxStatusMessage } from '@/types/tx'

export async function pollTxStatus(txId: string): Promise<TxStatusMessage | undefined> {
  console.debug('pollTxStatus', txId)
  // TODO: Query backendClient or direct RPC for status updates and return normalized payload.
  return undefined
}

export function scheduleTxTracking(txId: string, onUpdate: (message: TxStatusMessage) => void): () => void {
  console.debug('scheduleTxTracking', txId)
  // TODO: Replace with smarter poller using web sockets or SSE once backend is ready.
  const interval = window.setInterval(async () => {
    const update = await pollTxStatus(txId)
    if (update) {
      onUpdate(update)
    }
  }, 5000)

  return () => window.clearInterval(interval)
}
