import { atom } from 'jotai'

/**
 * Custom URL configuration for a chain
 */
export interface CustomChainUrls {
  rpcUrl?: string
  lcdUrl?: string
  indexerUrl?: string
  maspIndexerUrl?: string
}

/**
 * Custom URLs for EVM chains
 * Key: chain key (e.g., 'sepolia', 'base-sepolia')
 */
export const customEvmChainUrlsAtom = atom<Record<string, CustomChainUrls>>({})

/**
 * Custom URLs for Tendermint chains
 * Key: chain key (e.g., 'namada-testnet', 'noble-testnet')
 */
export const customTendermintChainUrlsAtom = atom<Record<string, CustomChainUrls>>({})

