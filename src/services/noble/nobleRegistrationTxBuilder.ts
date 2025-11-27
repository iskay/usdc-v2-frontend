/**
 * Noble Registration Transaction Builder
 * 
 * Builds signerless registration transactions for Noble forwarding addresses.
 * Ported from usdc-v2-backend/src/modules/noble-forwarding-tracker/registration.ts
 */

import protobuf from 'protobufjs/light.js'
import { bech32 } from 'bech32'
import Long from 'long'
import {
  TxBody,
  AuthInfo,
  SignerInfo,
  ModeInfo,
  Fee,
  TxRaw,
} from 'cosmjs-types/cosmos/tx/v1beta1/tx'
import { Any } from 'cosmjs-types/google/protobuf/any'
import { logger } from '@/utils/logger'

/**
 * Parameters for building a registration transaction
 */
export interface RegistrationTransactionParams {
  /** Noble forwarding address (bech32 format) */
  nobleAddress: string
  /** Namada recipient address */
  recipient: string
  /** IBC channel ID (e.g., 'channel-136') */
  channel: string
  /** Fallback address (optional, defaults to empty string) */
  fallback?: string
  /** Gas limit for the transaction */
  gasLimit: number
  /** Fee amount in uusdc (as string) */
  feeAmount: string
}

/**
 * Result of building a registration transaction
 */
export interface RegistrationTransactionResult {
  /** Base64-encoded transaction bytes */
  txBytes: string
}

/**
 * Build a signerless registration transaction for Noble forwarding
 * 
 * This creates a protobuf-encoded transaction that registers a Noble forwarding address
 * without requiring a signature (signerless transaction). The transaction is funded by
 * the balance in the forwarding address itself.
 * 
 * @param params - Registration transaction parameters
 * @returns Base64-encoded transaction bytes ready for broadcasting
 */
export function buildRegistrationTransaction(
  params: RegistrationTransactionParams,
): RegistrationTransactionResult {
  try {
    logger.debug('[NobleRegistrationTxBuilder] Building Noble forwarding registration transaction', {
      nobleAddress: params.nobleAddress.slice(0, 16) + '...',
      recipient: params.recipient.slice(0, 16) + '...',
      channel: params.channel,
      fallback: params.fallback || '',
      gasLimit: params.gasLimit,
      feeAmount: params.feeAmount,
    })

    // Build protobuf types dynamically using Root and namespace
    const root = new protobuf.Root()
    const ns = root.define('noble.forwarding.v1')

    const ForwardingPubKey = new protobuf.Type('ForwardingPubKey').add(
      new protobuf.Field('key', 1, 'bytes'),
    )
    ns.add(ForwardingPubKey)

    const MsgRegisterAccount = new protobuf.Type('MsgRegisterAccount')
      .add(new protobuf.Field('signer', 1, 'string'))
      .add(new protobuf.Field('recipient', 2, 'string'))
      .add(new protobuf.Field('channel', 3, 'string'))
      .add(new protobuf.Field('fallback', 4, 'string'))
    ns.add(MsgRegisterAccount)

    // Decode noble bech32 address to raw 20 bytes for ForwardingPubKey
    const decoded = bech32.decode(params.nobleAddress)
    const raw = bech32.fromWords(decoded.words)
    const rawBytes = new Uint8Array(raw)
    if (rawBytes.length !== 20) {
      throw new Error(
        `Invalid noble address bytes length: expected 20, got ${rawBytes.length}`,
      )
    }

    // Create MsgRegisterAccount message
    const msg = MsgRegisterAccount.create({
      signer: params.nobleAddress,
      recipient: params.recipient,
      channel: params.channel,
      fallback: params.fallback || '',
    })
    const msgBytes = MsgRegisterAccount.encode(msg).finish()
    const msgAny = Any.fromPartial({
      typeUrl: '/noble.forwarding.v1.MsgRegisterAccount',
      value: msgBytes,
    })

    // Build TxBody
    const bodyBytes = TxBody.encode(
      TxBody.fromPartial({
        messages: [msgAny],
        memo: '',
      }),
    ).finish()

    // Build ForwardingPubKey
    const pkBytes = ForwardingPubKey.encode({ key: rawBytes }).finish()
    const pkAny = Any.fromPartial({
      typeUrl: '/noble.forwarding.v1.ForwardingPubKey',
      value: pkBytes,
    })

    // Build AuthInfo with signerless signature (empty signature)
    const modeInfo = ModeInfo.fromPartial({
      single: { mode: 1 }, // SIGN_MODE_DIRECT
    })
    const signerInfo = SignerInfo.fromPartial({
      publicKey: pkAny,
      modeInfo,
      sequence: Long.UZERO,
    })

    const fee = Fee.fromPartial({
      gasLimit: Long.fromNumber(params.gasLimit),
      amount: [{ denom: 'uusdc', amount: params.feeAmount }],
    })

    const authInfoBytes = AuthInfo.encode(
      AuthInfo.fromPartial({
        signerInfos: [signerInfo],
        fee,
      }),
    ).finish()

    // Build TxRaw with empty signatures (signerless)
    const txRawBytes = TxRaw.encode(
      TxRaw.fromPartial({
        bodyBytes,
        authInfoBytes,
        signatures: [new Uint8Array()], // Empty signature for signerless transaction
      }),
    ).finish()

    // Encode to base64 for broadcast
    // Use btoa for browser compatibility (Buffer polyfill may not be available)
    const txBase64 = btoa(
      String.fromCharCode(...txRawBytes),
    )

    logger.debug('[NobleRegistrationTxBuilder] Successfully built registration transaction', {
      nobleAddress: params.nobleAddress.slice(0, 16) + '...',
      txBytesLength: txBase64.length,
    })

    return {
      txBytes: txBase64,
    }
  } catch (error) {
    logger.error('[NobleRegistrationTxBuilder] Failed to build registration transaction', {
      nobleAddress: params.nobleAddress.slice(0, 16) + '...',
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

