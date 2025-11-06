import type { TrackedTransaction } from '@/types/tx'

export interface BuildTxParams {
  amount: string
  sourceChain: string
  destinationChain: string
  recipient: string
}

export async function buildDepositTx(params: BuildTxParams): Promise<TrackedTransaction> {
  console.debug('buildDepositTx params', params)
  // TODO: Call wasm-enabled builders for shielded + CCTP flows.
  return {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    chain: params.destinationChain,
    direction: 'deposit',
    status: 'building',
  }
}

export async function buildPaymentTx(params: BuildTxParams): Promise<TrackedTransaction> {
  console.debug('buildPaymentTx params', params)
  // TODO: Connect to Namada SDK worker to assemble shielding + IBC transactions.
  return {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    chain: params.destinationChain,
    direction: 'send',
    status: 'building',
  }
}
