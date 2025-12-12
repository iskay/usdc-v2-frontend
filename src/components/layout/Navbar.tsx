import { useMemo } from 'react'
import { Menu } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { useWallet } from '@/hooks/useWallet'
import { ThemeToggle } from '@/components/common/ThemeToggle'

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
    return `${state.namada.account.slice(0, 8)}...${state.namada.account.slice(-6)}`
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
        <Button
          onClick={() => {
            if (state.metaMask.isConnected) {
              void disconnectMetaMask()
            } else {
              void connectMetaMask()
            }
          }}
          disabled={!isMetaMaskAvailable || isMetaMaskConnecting}
          variant={state.metaMask.isConnected ? 'secondary' : 'ghost'}
          className="gap-2 px-3 py-1.5 text-xs"
        >
          {isMetaMaskConnecting ? (
            <>Connecting...</>
          ) : state.metaMask.isConnected && truncatedMetaMaskAddress ? (
            <>
              <span className="text-xs">MetaMask</span>
              <span className="font-mono text-xs">{truncatedMetaMaskAddress}</span>
            </>
          ) : (
            <>Connect MetaMask</>
          )}
        </Button>

        {/* Namada Keychain Connection Button */}
        <Button
          onClick={() => {
            if (state.namada.isConnected) {
              void disconnectNamada()
            } else {
              void connectNamada()
            }
          }}
          disabled={isNamadaConnecting}
          variant={state.namada.isConnected ? 'secondary' : 'ghost'}
          className="gap-2 px-3 py-1.5 text-xs"
        >
          {isNamadaConnecting ? (
            <>Connecting...</>
          ) : state.namada.isConnected && truncatedNamadaAddress ? (
            <>
              <span className="text-xs">Namada</span>
              <span className="font-mono text-xs">{truncatedNamadaAddress}</span>
            </>
          ) : (
            <>Connect Namada</>
          )}
        </Button>

        {/* Theme Toggle */}
        <ThemeToggle />

        {/* TODO: Add chain selector, settings menu, and shielded sync controls. */}
      </div>
    </header>
  )
}
