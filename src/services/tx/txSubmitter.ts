import type { TrackedTransaction } from '@/types/tx'

export async function submitEvmTx(tx: TrackedTransaction): Promise<string> {
  console.debug('submitEvmTx', tx)
  // TODO: Use ethers provider + signer injected by MetaMask to submit deposit or payment tx.
  return '0xTODO'
}

export async function submitNamadaTx(tx: TrackedTransaction): Promise<string> {
  console.debug('submitNamadaTx', tx)
  // TODO: Bridge to Namada Keychain signing API and broadcast via RPC.
  return 'namadaTxHashTODO'
}
