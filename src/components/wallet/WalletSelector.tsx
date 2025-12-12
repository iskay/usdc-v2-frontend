import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/common/Button'
import { AlertBox } from '@/components/common/AlertBox'
import { useWallet } from '@/hooks/useWallet'

interface WalletAvailability {
  hasMetaMask: boolean
  hasNamada: boolean
  loading: boolean
}

export function WalletSelector() {
  const {
    connectMetaMask,
    connectNamada,
    state,
    error,
    isMetaMaskAvailable,
    checkNamadaAvailability,
  } = useWallet()

  const [availability, setAvailability] = useState<WalletAvailability>(() => ({
    hasMetaMask: isMetaMaskAvailable,
    hasNamada: typeof window !== 'undefined' ? Boolean(window.namada) : false,
    loading: true,
  }))

  useEffect(() => {
    let active = true
    async function detect(): Promise<void> {
      try {
        const hasNamada = await checkNamadaAvailability()
        if (!active) return
        setAvailability({ hasMetaMask: isMetaMaskAvailable, hasNamada, loading: false })
      } catch {
        if (!active) return
        setAvailability({ hasMetaMask: isMetaMaskAvailable, hasNamada: false, loading: false })
      }
    }

    void detect()
    return () => {
      active = false
    }
  }, [checkNamadaAvailability, isMetaMaskAvailable])

  const isMetaMaskConnecting = state.metaMask.isConnecting
  const isNamadaConnecting = state.namada.isConnecting
  const truncatedEvmAddress = useMemo(() => {
    if (!state.metaMask.account) return undefined
    return `${state.metaMask.account.slice(0, 6)}...${state.metaMask.account.slice(-4)}`
  }, [state.metaMask.account])

  const truncatedNamadaAddress = useMemo(() => {
    if (!state.namada.account) return undefined
    return `${state.namada.account.slice(0, 8)}...${state.namada.account.slice(-6)}`
  }, [state.namada.account])

  return (
    <div className="space-y-4">
      <AlertBox tone="info" title="Wallet connections">
        Connect MetaMask for EVM flows and Namada Keychain for shielded transfers. Availability is detected
        automatically.
      </AlertBox>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="space-y-3 rounded-lg border border-border bg-card/80 p-4 shadow-sm">
          <header className="space-y-1">
            <h3 className="text-base font-semibold">MetaMask</h3>
            <p className="text-sm text-muted-foreground">
              EVM chains for deposits and outbound payments.
            </p>
          </header>
          <Button
            onClick={connectMetaMask}
            disabled={!availability.hasMetaMask || isMetaMaskConnecting}
            variant={availability.hasMetaMask ? 'primary' : 'ghost'}
          >
            {availability.loading ? (
              'Detecting...'
            ) : availability.hasMetaMask ? (
              isMetaMaskConnecting ? (
                'Connecting...'
              ) : state.metaMask.isConnected ? (
                'Reconnect MetaMask'
              ) : (
                <>
                  <img src="/assets/logos/metamask-logo.svg" alt="MetaMask" className="h-4 w-4" />
                  <span>Connect MetaMask</span>
                </>
              )
            ) : (
              'MetaMask Not Detected'
            )}
          </Button>
          {state.metaMask.isConnected && state.metaMask.account ? (
            <div className="space-y-1 text-xs text-muted-foreground">
              <p className="truncate">Connected: {truncatedEvmAddress}</p>
              {state.metaMask.chainId ? <p>Chain ID: {state.metaMask.chainId}</p> : null}
            </div>
          ) : null}
        </section>
        <section className="space-y-3 rounded-lg border border-border bg-card/80 p-4 shadow-sm">
          <header className="space-y-1">
            <h3 className="text-base font-semibold">Namada Keychain</h3>
            <p className="text-sm text-muted-foreground">
              Shielded + transparent accounts for Namada flows.
            </p>
          </header>
          <Button
            onClick={connectNamada}
            disabled={!availability.hasNamada || isNamadaConnecting}
            variant={availability.hasNamada ? 'secondary' : 'ghost'}
          >
            {availability.loading ? (
              'Detecting...'
            ) : availability.hasNamada ? (
              isNamadaConnecting ? (
                'Connecting...'
              ) : state.namada.isConnected ? (
                'Reconnect Namada'
              ) : (
                <>
                  <img src="/assets/logos/namada-logo.svg" alt="Namada" className="h-4 w-4" />
                  <span>Connect Namada</span>
                </>
              )
            ) : (
              'Namada Keychain Not Detected'
            )}
          </Button>
          {state.namada.isConnected && state.namada.account ? (
            <div className="space-y-1 text-xs text-muted-foreground">
              <p className="truncate">Transparent: {truncatedNamadaAddress}</p>
              {state.namada.shieldedAccount ? (
                <p className="truncate">Shielded: {state.namada.shieldedAccount.slice(0, 10)}...</p>
              ) : null}
              {state.namada.alias ? <p>Alias: {state.namada.alias}</p> : null}
            </div>
          ) : null}
        </section>
      </div>
      {error ? (
        <AlertBox tone="error" title="Wallet Error">
          {error}
        </AlertBox>
      ) : null}
    </div>
  )
}
