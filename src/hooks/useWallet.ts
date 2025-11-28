import { useCallback, useEffect } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { walletAtom, walletErrorAtom } from '@/atoms/walletAtom'
import {
  connectMetaMask as connectMetaMaskService,
  connectNamada as connectNamadaService,
  disconnectMetaMask as disconnectMetaMaskService,
  disconnectNamada as disconnectNamadaService,
  disconnectWallets,
  isMetaMaskAvailable,
  isNamadaAvailable as checkNamadaAvailability,
} from '@/services/wallet/walletService'
import { checkNamadaConnection } from '@/services/wallet/namadaKeychain'
import { NAMADA_CHAIN_ID } from '@/config/constants'
import { onWalletEvent, offWalletEvent } from '@/services/wallet/walletEvents'
import { useToast } from '@/hooks/useToast'
import { requestBalanceRefresh } from '@/services/balance/balanceService'

function formatAddress(address: string, startLength = 6, endLength = 4): string {
  if (address.length <= startLength + endLength) return address
  return `${address.slice(0, startLength)}...${address.slice(-endLength)}`
}

export function useWallet() {
  const [walletState, setWalletState] = useAtom(walletAtom)
  const setWalletError = useSetAtom(walletErrorAtom)
  const walletError = useAtomValue(walletErrorAtom)
  const metaMaskAvailable = isMetaMaskAvailable()
  const { notify } = useToast()

  useEffect(() => {
    function handleEvmAccountsChanged(payload: { accounts: string[] }) {
      const isNowConnected = payload.accounts.length > 0
      const account = payload.accounts[0]

      let wasConnected = false
      let previousAccount: string | undefined

      setWalletState((state) => {
        wasConnected = state.metaMask.isConnected
        previousAccount = state.metaMask.account
        return {
          ...state,
          metaMask: {
            ...state.metaMask,
            isConnecting: false,
            isConnected: isNowConnected,
            account,
          },
          lastUpdated: Date.now(),
        }
      })
      setWalletError(undefined)

      if (isNowConnected && account) {
        if (!wasConnected) {
          notify({
            title: 'MetaMask Connected',
            description: `Account: ${formatAddress(account)}`,
            level: 'success',
          })
        } else if (account !== previousAccount) {
          notify({
            title: 'MetaMask Account Changed',
            description: `Switched to: ${formatAddress(account)}`,
            level: 'info',
          })
        }
      } else if (wasConnected) {
        notify({
          title: 'MetaMask Disconnected',
          description: 'Account disconnected',
          level: 'info',
        })
      }
    }

    function handleEvmChainChanged(payload: { chainIdHex: string }) {
      const chainId = Number.parseInt(payload.chainIdHex, 16)
      let previousChainHex: string | undefined
      let wasConnected = false

      setWalletState((state) => {
        previousChainHex = state.metaMask.chainHex
        wasConnected = state.metaMask.isConnected
        return {
          ...state,
          metaMask: {
            ...state.metaMask,
            isConnecting: false,
            chainHex: payload.chainIdHex,
            chainId: Number.isNaN(chainId) ? state.metaMask.chainId : chainId,
          },
          lastUpdated: Date.now(),
        }
      })

      // Only show toast if chain actually changed (not on initial connection)
      if (wasConnected && previousChainHex && previousChainHex !== payload.chainIdHex) {
        notify({
          title: 'Network Changed',
          description: `Chain ID: ${chainId}`,
          level: 'info',
        })
      }
    }

    function handleEvmDisconnected() {
      let wasConnected = false
      setWalletState((state) => {
        wasConnected = state.metaMask.isConnected
        return {
          ...state,
          metaMask: {
            isConnecting: false,
            isConnected: false,
            account: undefined,
            chainId: undefined,
            chainHex: undefined,
          },
          lastUpdated: Date.now(),
        }
      })
      setWalletError(undefined)

      if (wasConnected) {
        notify({
          title: 'MetaMask Disconnected',
          description: 'Wallet disconnected',
          level: 'info',
        })
      }
    }

    function handleNamadaAccountsChanged(payload: {
      transparentAddress?: string
      shieldedAddress?: string
      accountAlias?: string
      viewingKey?: string
    }) {
      let wasConnected = false
      const account = payload.transparentAddress

      setWalletState((state) => {
        wasConnected = state.namada.isConnected
        return {
          ...state,
          namada: {
            ...state.namada,
            isConnecting: false,
            isConnected: true,
            account: payload.transparentAddress,
            shieldedAccount: payload.shieldedAddress,
            alias: payload.accountAlias,
            viewingKey: payload.viewingKey,
          },
          lastUpdated: Date.now(),
        }
      })
      setWalletError(undefined)

      if (account && !wasConnected) {
        notify({
          title: 'Namada Keychain Connected',
          description: `Account: ${formatAddress(account, 8, 6)}`,
          level: 'success',
        })
        // Trigger immediate balance refresh when transparent address becomes available
        void requestBalanceRefresh({ trigger: 'manual' })
      }
    }

    function handleNamadaDisconnected() {
      let wasConnected = false
      setWalletState((state) => {
        wasConnected = state.namada.isConnected
        return {
          ...state,
          namada: {
            isConnecting: false,
            isConnected: false,
            account: undefined,
            shieldedAccount: undefined,
            alias: undefined,
            viewingKey: undefined,
          },
          lastUpdated: Date.now(),
        }
      })
      setWalletError(undefined)

      if (wasConnected) {
        notify({
          title: 'Namada Keychain Disconnected',
          description: 'Wallet disconnected',
          level: 'info',
        })
      }
    }

    onWalletEvent('evm:accountsChanged', handleEvmAccountsChanged)
    onWalletEvent('evm:chainChanged', handleEvmChainChanged)
    onWalletEvent('evm:disconnected', handleEvmDisconnected)
    onWalletEvent('namada:accountsChanged', handleNamadaAccountsChanged)
    onWalletEvent('namada:disconnected', handleNamadaDisconnected)

    return () => {
      offWalletEvent('evm:accountsChanged', handleEvmAccountsChanged)
      offWalletEvent('evm:chainChanged', handleEvmChainChanged)
      offWalletEvent('evm:disconnected', handleEvmDisconnected)
      offWalletEvent('namada:accountsChanged', handleNamadaAccountsChanged)
      offWalletEvent('namada:disconnected', handleNamadaDisconnected)
    }
  }, [setWalletError, setWalletState, notify])

  const connectMetaMask = useCallback(async () => {
    setWalletState((state) => ({
      ...state,
      metaMask: { ...state.metaMask, isConnecting: true },
    }))
    try {
      const connection = await connectMetaMaskService()
      setWalletState((state) => ({
        ...state,
        metaMask: {
          ...state.metaMask,
          isConnecting: false,
          isConnected: true,
          account: connection.evm?.address,
          chainId: connection.evm?.chainId,
          chainHex: connection.evm?.chainIdHex,
        },
        lastUpdated: connection.connectedAt,
      }))
      setWalletError(undefined)
      // Success toast will be shown by the event handler
    } catch (error) {
      console.error('MetaMask connection failed', error)
      const message = error instanceof Error ? error.message : 'Unable to connect MetaMask'
      setWalletError(message)
      setWalletState((state) => ({
        ...state,
        metaMask: { ...state.metaMask, isConnecting: false },
      }))
      notify({
        title: 'MetaMask Connection Failed',
        description: message,
        level: 'error',
      })
    }
  }, [setWalletError, setWalletState, notify])

  const connectNamada = useCallback(async () => {
    setWalletState((state) => ({
      ...state,
      namada: { ...state.namada, isConnecting: true },
    }))
    try {
      const connection = await connectNamadaService()
      const transparentAddress = connection.namada?.transparentAddress
      
      setWalletState((state) => ({
        ...state,
        namada: {
          ...state.namada,
          isConnecting: false,
          isConnected: true,
          account: transparentAddress,
          shieldedAccount: connection.namada?.shieldedAddress,
          alias: connection.namada?.accountAlias,
          viewingKey: connection.namada?.viewingKey,
        },
        lastUpdated: connection.connectedAt,
      }))
      setWalletError(undefined)
      
      // Trigger immediate balance refresh when transparent address becomes available
      if (transparentAddress) {
        void requestBalanceRefresh({ trigger: 'manual' })
      }
      
      // Success toast will be shown by the event handler
    } catch (error) {
      console.error('Namada connection failed', error)
      const message = error instanceof Error ? error.message : 'Unable to connect Namada Keychain'
      setWalletError(message)
      setWalletState((state) => ({
        ...state,
        namada: { ...state.namada, isConnecting: false },
      }))
      notify({
        title: 'Namada Keychain Connection Failed',
        description: message,
        level: 'error',
      })
    }
  }, [setWalletError, setWalletState, notify])

  const disconnectMetaMask = useCallback(async () => {
    setWalletState((state) => ({
      ...state,
      metaMask: { ...state.metaMask, isConnecting: true },
    }))
    try {
      await disconnectMetaMaskService()
    } finally {
      setWalletState((state) => ({
        ...state,
        metaMask: {
          isConnecting: false,
          isConnected: false,
          account: undefined,
          chainId: undefined,
          chainHex: undefined,
        },
        lastUpdated: Date.now(),
      }))
      setWalletError(undefined)
    }
  }, [setWalletError, setWalletState])

  const disconnectNamada = useCallback(async () => {
    setWalletState((state) => ({
      ...state,
      namada: { ...state.namada, isConnecting: true },
    }))
    try {
      await disconnectNamadaService()
      // Disconnect succeeded - user approved
      setWalletState((state) => ({
        ...state,
        namada: {
          isConnecting: false,
          isConnected: false,
          account: undefined,
          shieldedAccount: undefined,
          alias: undefined,
          viewingKey: undefined,
        },
        lastUpdated: Date.now(),
      }))
      setWalletError(undefined)
    } catch (error) {
      // Disconnect failed - user likely disapproved
      // Verify actual connection status to sync state
      const isStillConnected = await checkNamadaConnection(NAMADA_CHAIN_ID)
      
      setWalletState((state) => ({
        ...state,
        namada: {
          ...state.namada,
          isConnecting: false,
          // Keep connection state as-is if user disapproved
          isConnected: isStillConnected,
        },
        lastUpdated: Date.now(),
      }))
      
      if (isStillConnected) {
        // User disapproved - still connected
        notify({
          title: 'Disconnect Cancelled',
          description: 'Namada Keychain connection remains active',
          level: 'info',
        })
      } else {
        // Connection was lost for some other reason
        setWalletError(undefined)
      }
    }
  }, [setWalletError, setWalletState, notify])

  const disconnect = useCallback(async () => {
    setWalletState((state) => ({
      ...state,
      metaMask: { ...state.metaMask, isConnecting: true },
      namada: { ...state.namada, isConnecting: true },
    }))
    try {
      await disconnectWallets()
    } finally {
      setWalletState({
        metaMask: {
          isConnecting: false,
          isConnected: false,
          account: undefined,
          chainId: undefined,
          chainHex: undefined,
        },
        namada: {
          isConnecting: false,
          isConnected: false,
          account: undefined,
          shieldedAccount: undefined,
          alias: undefined,
          viewingKey: undefined,
        },
        lastUpdated: Date.now(),
      })
      setWalletError(undefined)
    }
  }, [setWalletError, setWalletState])

  return {
    state: walletState,
    error: walletError,
    isMetaMaskAvailable: metaMaskAvailable,
    checkNamadaAvailability: checkNamadaAvailability,
    connectMetaMask,
    connectNamada,
    disconnectMetaMask,
    disconnectNamada,
    disconnect,
  }
}
