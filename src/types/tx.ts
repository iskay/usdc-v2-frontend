import type { FlowInitiationMetadata } from './flow'

export type TxStage =
  | 'idle'
  | 'connecting-wallet'
  | 'building'
  | 'signing'
  | 'submitting'
  | 'broadcasted'
  | 'finalized'
  | 'error'
  | 'undetermined' // Status when polling times out without resolution - distinct from 'error'

export interface TrackedTransaction {
  id: string
  createdAt: number
  /** Last update timestamp (for sorting and tracking updates) */
  updatedAt: number
  chain: string
  direction: 'deposit' | 'send'
  status: TxStage
  hash?: string
  errorMessage?: string
  /** Backend flowId (canonical identifier after flow registration) */
  flowId?: string
  /** Local flow metadata (for flow-based tracking) */
  flowMetadata?: FlowInitiationMetadata
  /** Block height where the transaction was included (for Namada transactions) */
  blockHeight?: string
}

export interface TxStatusMessage {
  txId: string
  stage: TxStage
  summary: string
  occurredAt: number
}

// TODO: Add multi-chain receipt metadata and explorer link helpers.
