import { useMemo } from 'react'
import { Menu, Loader2 } from 'lucide-react'
import { useWallet } from '@/hooks/useWallet'
import { ThemeToggle } from '@/components/common/ThemeToggle'
import { cn } from '@/lib/utils'

interface NavbarProps {
  onToggleSidebar: () => void
}

export function Navbar({ onToggleSidebar }: NavbarProps) {
  const {
    state,
    connectMetaMask,
    connectNamada,
    disconnectMetaMask,
    disconnectNamada,
    isMetaMaskAvailable,
  } = useWallet()

  const truncatedMetaMaskAddress = useMemo(() => {
    if (!state.metaMask.account) return undefined
    return `${state.metaMask.account.slice(0, 6)}...${state.metaMask.account.slice(-4)}`
  }, [state.metaMask.account])

  const truncatedNamadaAddress = useMemo(() => {
    if (!state.namada.account) return undefined
    return `${state.namada.account.slice(0, 8)}...${state.namada.account.slice(-4)}`
  }, [state.namada.account])

  const isMetaMaskConnecting = state.metaMask.isConnecting
  const isNamadaConnecting = state.namada.isConnecting

  return (
    <header className="flex items-center justify-between border-b border-border bg-background/80 px-6 py-4 backdrop-blur">
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="flex items-center justify-center rounded-md p-2 text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          aria-label="Toggle sidebar"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="space-y-1">
          <p className="text-sm uppercase tracking-widest text-muted-foreground">Borderless Private USDC</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {/* MetaMask Connection Button */}
        <button
          type="button"
          onClick={() => {
            if (state.metaMask.isConnected) {
              void disconnectMetaMask()
            } else {
              void connectMetaMask()
            }
          }}
          disabled={!isMetaMaskAvailable || isMetaMaskConnecting}
          className={cn(
            'btn-wallet-connection',
            state.metaMask.isConnected
              ? 'btn-wallet-connection-connected'
              : 'btn-wallet-connection-disconnected',
          )}
        >
          {isMetaMaskConnecting ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Connecting...</span>
            </>
          ) : state.metaMask.isConnected && truncatedMetaMaskAddress ? (
            <>
              <div className="h-2 w-2 rounded-full bg-success" />
              <span className="text-xs">MetaMask</span>
              <span className="font-mono text-xs">{truncatedMetaMaskAddress}</span>
            </>
          ) : (
            <>
              <img src="/assets/logos/metamask-logo.svg" alt="MetaMask" className="h-4 w-4" />
              <span>Connect MetaMask</span>
            </>
          )}
        </button>

        {/* Namada Keychain Connection Button */}
        <button
          type="button"
          onClick={() => {
            if (state.namada.isConnected) {
              void disconnectNamada()
            } else {
              void connectNamada()
            }
          }}
          disabled={isNamadaConnecting}
          className={cn(
            'btn-wallet-connection',
            state.namada.isConnected
              ? 'btn-wallet-connection-connected'
              : 'btn-wallet-connection-disconnected',
          )}
        >
          {isNamadaConnecting ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Connecting...</span>
            </>
          ) : state.namada.isConnected && truncatedNamadaAddress ? (
            <>
              <div className="h-2 w-2 rounded-full bg-success" />
              <span className="text-xs">Namada</span>
              <span className="font-mono text-xs">{truncatedNamadaAddress}</span>
            </>
          ) : (
            <>
              <img src="/assets/logos/namada-logo.svg" alt="Namada" className="h-4 w-4" />
              <span>Connect Namada</span>
            </>
          )}
        </button>

        {/* Theme Toggle */}
        <ThemeToggle />

        {/* TODO: Add chain selector, settings menu, and shielded sync controls. */}
      </div>
    </header>
  )
}
