export type TxStage =
  | 'idle'
  | 'connecting-wallet'
  | 'building'
  | 'signing'
  | 'submitting'
  | 'broadcasted'
  | 'finalized'
  | 'error'

export interface TrackedTransaction {
  id: string
  createdAt: number
  chain: string
  direction: 'deposit' | 'send'
  status: TxStage
  hash?: string
  errorMessage?: string
}

export interface TxStatusMessage {
  txId: string
  stage: TxStage
  summary: string
  occurredAt: number
}

// TODO: Add multi-chain receipt metadata and explorer link helpers.
