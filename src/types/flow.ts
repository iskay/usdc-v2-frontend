/**
 * Flow types for transaction status tracking and synchronization with backend.
 * These types match the backend flow model defined in usdc-v2-backend/docs/frontend-sync.md
 */

/**
 * Shielded transaction metadata (client-side only due to privacy)
 * This data cannot be sent to the backend due to Namada's shielded transaction privacy properties
 */
export interface ShieldedMetadata {
  /** Namada shielded address */
  shieldedAddress?: string;
  /** Namada transparent address */
  transparentAddress?: string;
  /** Viewing key for viewing shielded balances */
  viewingKey?: string;
  /** Additional shielded-specific metadata */
  [key: string]: unknown;
}

/**
 * Flow initiation metadata stored locally in the frontend.
 * This is created before the first transaction and updated with flowId after backend registration.
 */
export interface FlowInitiationMetadata {
  /** Frontend-generated identifier (used before backend flowId is available) */
  localId: string;

  /** Backend flowId (set after initial backend call) */
  flowId?: string;

  /** Flow type */
  flowType: 'deposit' | 'payment';

  /** Initiating chain information */
  initialChain: string;
  initialChainType: 'evm' | 'tendermint';

  /** Transaction details */
  amount: string; // Token amount in base units
  token: 'USDC'; // Token identifier

  /** Shielded transaction metadata (client-side only due to privacy) */
  shieldedMetadata?: ShieldedMetadata;

  /** Timestamp when flow was initiated */
  initiatedAt: number;

  /** UI state */
  status: 'initiating' | 'tracking' | 'completed' | 'failed';
}

/**
 * Individual stage within a chain's progress
 */
export interface ChainStage {
  /** Stage identifier (e.g., 'gasless_quote_pending', 'tx_confirmed') */
  stage: string;
  /** Stage status */
  status?: 'pending' | 'confirmed' | 'failed';
  /** Optional message describing the stage */
  message?: string;
  /** Transaction hash if applicable */
  txHash?: string;
  /** ISO timestamp when stage occurred */
  occurredAt?: string;
  /** Source of the stage update */
  source: 'client' | 'poller';
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Per-chain progress entry from backend
 */
export interface ChainProgressEntry {
  /** Chain status */
  status?: string;
  /** Transaction hash for this chain */
  txHash?: string;
  /** Regular stages */
  stages?: ChainStage[];
  /** Gasless transaction stages */
  gaslessStages?: ChainStage[];
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Flow status from backend (source of truth for live transaction status)
 */
export interface FlowStatus {
  /** Backend flowId (canonical identifier) */
  flowId: string;

  /** Overall status */
  status: 'pending' | 'completed' | 'failed' | 'undetermined';

  /** Per-chain progress (from backend) */
  chainProgress: {
    evm?: ChainProgressEntry;
    noble?: ChainProgressEntry;
    namada?: ChainProgressEntry;
  };

  /** Last updated timestamp */
  lastUpdated: number;
}

/**
 * Input for starting flow tracking on backend
 */
export interface StartFlowTrackingInput {
  flowType: 'deposit' | 'payment';
  initialChain: string;
  destinationChain: string;
  chainType: 'evm' | 'tendermint';
  txHash: string; // First transaction hash
  metadata?: Record<string, unknown>;
}

/**
 * Response from backend when starting flow tracking
 */
export interface StartFlowTrackingResponse {
  data: {
    id: string; // flowId
    txHash: string;
    status: string;
    chainProgress: FlowStatus['chainProgress'];
  };
}

/**
 * Input for reporting client-side stage to backend
 */
export interface ClientStageInput {
  chain: 'evm' | 'noble' | 'namada';
  stage: string;
  status?: 'pending' | 'confirmed' | 'failed';
  message?: string;
  txHash?: string;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
  kind?: 'gasless' | 'default';
  source: 'client' | 'poller';
}

/**
 * UI-friendly stage representation for display
 */
export interface UIStage {
  chain: 'evm' | 'noble' | 'namada';
  stage: string;
  status: 'pending' | 'confirmed' | 'failed';
  txHash?: string;
  occurredAt?: string;
  message?: string;
}

