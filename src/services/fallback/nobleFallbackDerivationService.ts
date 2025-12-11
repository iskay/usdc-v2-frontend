/**
 * Service for deriving Noble bech32 fallback addresses from MetaMask EVM public keys.
 * 
 * This service prompts the user to sign a message with MetaMask, extracts the public key
 * from the signature, and derives the equivalent Noble bech32 address using the standard
 * Cosmos SDK address derivation (SHA256 + RIPEMD160 + bech32 encoding).
 */

import { hashMessage, SigningKey, Signature } from 'ethers'
import { bech32 } from 'bech32'
import { sha256 } from '@noble/hashes/sha256'
import { ripemd160 } from '@noble/hashes/ripemd160'
import { logger } from '@/utils/logger'
import { isMetaMaskAvailable } from '@/services/wallet/walletService'

/**
 * Compresses an uncompressed secp256k1 public key (65 bytes) to compressed format (33 bytes).
 * @param publicKey - Uncompressed public key as hex string (0x prefix) or Uint8Array
 * @returns Compressed public key as Uint8Array (33 bytes)
 */
function compressPublicKey(publicKey: string | Uint8Array): Uint8Array {
  let pubBytes: Uint8Array

  if (typeof publicKey === 'string') {
    // Remove 0x prefix if present
    const hex = publicKey.startsWith('0x') ? publicKey.slice(2) : publicKey
    // Convert hex string to Uint8Array (browser-compatible)
    pubBytes = new Uint8Array(hex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [])
  } else {
    pubBytes = publicKey
  }

  // If already compressed (33 bytes), return as-is
  if (pubBytes.length === 33) {
    return pubBytes
  }

  // If uncompressed (65 bytes: 0x04 + X + Y)
  if (pubBytes.length === 65 && pubBytes[0] === 0x04) {
    const x = pubBytes.slice(1, 33)
    const y = pubBytes.slice(33, 65)
    const isYOdd = (y[y.length - 1] & 1) === 1
    const prefix = new Uint8Array([isYOdd ? 0x03 : 0x02])
    return new Uint8Array([...prefix, ...x])
  }

  throw new Error(`Invalid public key format: expected 33 or 65 bytes, got ${pubBytes.length}`)
}

/**
 * Derives a Noble bech32 address from a compressed secp256k1 public key.
 * Uses the standard Cosmos SDK address derivation: SHA256(compressedPubKey) -> RIPEMD160 -> bech32 encode.
 * @param compressedPubKey - Compressed public key (33 bytes)
 * @returns Noble bech32 address (e.g., 'noble1...')
 */
function deriveNobleAddress(compressedPubKey: Uint8Array): string {
  logger.debug('[NobleFallbackDerivation] Deriving Noble address from compressed public key', {
    pubKeyLength: compressedPubKey.length,
    pubKeyHex: Array.from(compressedPubKey)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(''),
  })

  // SHA256 hash
  const sha256Hash = sha256(compressedPubKey)
  logger.debug('[NobleFallbackDerivation] SHA256 hash computed', {
    hashHex: Array.from(sha256Hash)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(''),
  })

  // RIPEMD160 hash
  const addressBytes = ripemd160(sha256Hash)
  logger.debug('[NobleFallbackDerivation] RIPEMD160 hash computed', {
    addressBytesHex: Array.from(addressBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(''),
  })

  // Bech32 encode with 'noble' prefix
  const words = bech32.toWords(addressBytes)
  const nobleAddress = bech32.encode('noble', words)

  logger.info('[NobleFallbackDerivation] Noble address derived successfully', {
    address: nobleAddress,
    addressBytesLength: addressBytes.length,
  })

  return nobleAddress
}

/**
 * Recovers the public key from a MetaMask signature.
 * @param message - The message that was signed
 * @param signature - The signature hex string from MetaMask
 * @returns Uncompressed public key as hex string (without 0x prefix)
 */
function recoverPublicKeyFromSignature(message: string, signature: string): string {
  logger.debug('[NobleFallbackDerivation] Recovering public key from signature', {
    messageLength: message.length,
    signatureLength: signature.length,
  })

  try {
    // Hash the message (ethers.js handles the Ethereum message prefix)
    const messageHash = hashMessage(message)
    logger.debug('[NobleFallbackDerivation] Message hash computed', {
      hash: messageHash,
    })

    // Parse signature for logging purposes
    const sig = Signature.from(signature)
    logger.debug('[NobleFallbackDerivation] Signature parsed', {
      r: sig.r,
      s: sig.s,
      v: sig.v,
    })

    // Recover public key using SigningKey.recoverPublicKey (ethers v6.15 method)
    const publicKey = SigningKey.recoverPublicKey(messageHash, signature)
    logger.debug('[NobleFallbackDerivation] Public key recovered', {
      publicKeyLength: publicKey.length,
      publicKey: publicKey,
    })

    return publicKey
  } catch (error) {
    logger.error('[NobleFallbackDerivation] Failed to recover public key', {
      error: error instanceof Error ? error.message : String(error),
    })
    throw new Error(`Failed to recover public key from signature: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export interface DeriveNobleFallbackResult {
  /** The derived Noble bech32 address */
  nobleAddress: string
  /** The EVM address that was used for derivation */
  evmAddress: string
  /** The uncompressed public key used for derivation */
  publicKey: string
}

export interface DeriveNobleFallbackOptions {
  /** Custom message to sign (default: "Derive Noble fallback address") */
  message?: string
  /** EVM address to use (default: first account from MetaMask) */
  evmAddress?: string
}

/**
 * Derives a Noble bech32 fallback address from the user's MetaMask EVM public key.
 * 
 * Process:
 * 1. Prompts user to sign a message via MetaMask personal_sign
 * 2. Recovers the public key from the signature
 * 3. Compresses the public key to 33 bytes
 * 4. Derives Noble address using SHA256 + RIPEMD160 + bech32 encoding
 * 
 * @param options - Optional configuration
 * @returns The derived Noble address and EVM address used
 * @throws Error if MetaMask is not available, user rejects signature, or derivation fails
 */
export async function deriveNobleFallbackFromMetaMask(
  options: DeriveNobleFallbackOptions = {}
): Promise<DeriveNobleFallbackResult> {
  logger.info('[NobleFallbackDerivation] Starting Noble fallback address derivation from MetaMask')

  // Check MetaMask availability
  if (!isMetaMaskAvailable()) {
    const error = 'MetaMask is not available. Please install and enable the MetaMask extension.'
    logger.error('[NobleFallbackDerivation] MetaMask not available')
    throw new Error(error)
  }

  if (!window.ethereum) {
    const error = 'Ethereum provider not found'
    logger.error('[NobleFallbackDerivation] Ethereum provider not found')
    throw new Error(error)
  }

  // Get EVM address
  let evmAddress: string
  if (options.evmAddress) {
    evmAddress = options.evmAddress
    logger.debug('[NobleFallbackDerivation] Using provided EVM address', {
      address: evmAddress,
    })
  } else {
    // Request accounts from MetaMask
    logger.debug('[NobleFallbackDerivation] Requesting accounts from MetaMask')
    const accounts = (await window.ethereum.request({
      method: 'eth_requestAccounts',
    })) as string[] | undefined

    if (!accounts || accounts.length === 0) {
      const error = 'No MetaMask accounts available. Please unlock your MetaMask wallet.'
      logger.error('[NobleFallbackDerivation] No accounts available')
      throw new Error(error)
    }

    evmAddress = accounts[0]
    logger.debug('[NobleFallbackDerivation] Using first MetaMask account', {
      address: evmAddress,
    })
  }

  // Prepare message to sign
  const message = options.message || 'Derive Noble fallback address'
  logger.debug('[NobleFallbackDerivation] Requesting signature', {
    message,
    evmAddress,
  })

  // Request signature from MetaMask
  let signature: string
  try {
    signature = (await window.ethereum.request({
      method: 'personal_sign',
      params: [message, evmAddress],
    })) as string

    logger.debug('[NobleFallbackDerivation] Signature received', {
      signatureLength: signature.length,
      signature: signature.slice(0, 20) + '...',
    })
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 4001) {
      const errorMsg = 'Signature request was rejected by user'
      logger.warn('[NobleFallbackDerivation] User rejected signature')
      throw new Error(errorMsg)
    }
    logger.error('[NobleFallbackDerivation] Signature request failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    throw new Error(`Failed to get signature from MetaMask: ${error instanceof Error ? error.message : String(error)}`)
  }

  // Recover public key from signature
  logger.debug('[NobleFallbackDerivation] Recovering public key from signature')
  const publicKeyHex = recoverPublicKeyFromSignature(message, signature)

  // Compress public key
  logger.debug('[NobleFallbackDerivation] Compressing public key')
  const compressedPubKey = compressPublicKey(publicKeyHex)
  logger.debug('[NobleFallbackDerivation] Public key compressed', {
    compressedLength: compressedPubKey.length,
    compressedHex: Array.from(compressedPubKey)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(''),
  })

  // Derive Noble address
  logger.debug('[NobleFallbackDerivation] Deriving Noble address')
  const nobleAddress = deriveNobleAddress(compressedPubKey)

  logger.info('[NobleFallbackDerivation] ✅ Noble fallback address derived successfully', {
    evmAddress,
    nobleAddress,
    publicKeyLength: publicKeyHex.length,
  })

  return {
    nobleAddress,
    evmAddress,
    publicKey: publicKeyHex,
  }
}

/**
 * Helper function to save a derived fallback address to storage.
 * This is a convenience wrapper that imports and calls the storage service.
 * @param result - The result from deriveNobleFallbackFromMetaMask
 */
export async function saveDerivedFallbackToStorage(
  result: DeriveNobleFallbackResult
): Promise<void> {
  const { saveDerivedFallbackAddress } = await import('@/services/storage/nobleFallbackDerivedStorage')
  saveDerivedFallbackAddress(result.evmAddress, result.nobleAddress, result.publicKey)
  logger.debug('[NobleFallbackDerivation] Saved derived address to storage', {
    evmAddress: result.evmAddress,
    nobleAddress: result.nobleAddress.slice(0, 16) + '...',
  })
}
