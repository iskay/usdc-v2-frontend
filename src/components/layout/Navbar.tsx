import { useMemo, useState } from 'react'
import { Menu, X, Loader2, Settings } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useWallet } from '@/hooks/useWallet'
import { useBalance } from '@/hooks/useBalance'
import { useAtomValue } from 'jotai'
import { balanceSyncAtom, balanceErrorAtom } from '@/atoms/balanceAtom'
import { cn } from '@/lib/utils'

interface NavbarProps {
  // Sidebar props disabled but kept for potential restoration
  // onToggleSidebar?: () => void
  // isSidebarCollapsed?: boolean
}

const navLinks = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/deposit', label: 'Deposit' },
  { to: '/send', label: 'Send Payment' },
  { to: '/history', label: 'Transaction History' },
]

export function Navbar({}: NavbarProps) {
  // Sidebar props disabled but kept for potential restoration
  // export function Navbar({ onToggleSidebar, isSidebarCollapsed }: NavbarProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const {
    state,
    connectMetaMask,
    connectNamada,
    disconnectMetaMask,
    disconnectNamada,
    isMetaMaskAvailable,
  } = useWallet()
  const { state: balanceState } = useBalance()
  const balanceSyncState = useAtomValue(balanceSyncAtom)
  const balanceError = useAtomValue(balanceErrorAtom)

  // Check for balance calculation error state
  const hasBalanceError = balanceSyncState.shieldedStatus === 'error' && balanceError
  const shieldedBalance = hasBalanceError ? '--' : balanceState.namada.usdcShielded
  const hasShieldedBalance = shieldedBalance && shieldedBalance !== '--' && parseFloat(shieldedBalance) > 0

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

  const handleNavLinkClick = (isDisabled: boolean, e: React.MouseEvent) => {
    if (isDisabled) {
      e.preventDefault()
    } else {
      setIsMobileMenuOpen(false)
    }
  }

  return (
    <header className="relative z-50 flex items-center justify-between border-border bg-background/80 px-4 sm:px-8 py-4 pb-8 backdrop-blur">
      <div className="flex items-center gap-3">
        <div className="relative h-14 w-68">
          <img
            src="/assets/logos/wordmark-light.png"
            alt="Borderless Private USDC"
            className="h-14 w-68 dark:hidden"
          />
          <img
            src="/assets/logos/wordmark-dark.png"
            alt="Borderless Private USDC"
            className="hidden h-14 w-68 dark:block"
          />
        </div>
      </div>
      
      {/* Desktop Navigation */}
      <nav className="hidden xl:flex items-center gap-12 px-8">
        {navLinks.map(({ to, label }) => {
          const isSendPayment = to === '/send'
          const isDisabled = isSendPayment && !hasShieldedBalance
          
          return (
            <NavLink
              key={to}
              to={isDisabled ? '#' : to}
              onClick={(e) => {
                if (isDisabled) {
                  e.preventDefault()
                }
              }}
              className={({ isActive }) =>
                cn(
                  'text-sm transition-colors',
                  isDisabled
                    ? 'cursor-not-allowed opacity-50 text-muted-foreground'
                    : isActive
                    ? 'font-normal text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )
              }
              end={to === '/dashboard'}
            >
              {label}
            </NavLink>
          )
        })}
      </nav>

      {/* Mobile Menu Button */}
      <button
        type="button"
        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        className="xl:hidden flex items-center justify-center h-9 w-9 rounded-full transition-colors text-muted-foreground hover:bg-muted-foreground/10 hover:text-accent-foreground"
        aria-label="Toggle menu"
        aria-expanded={isMobileMenuOpen}
      >
        {isMobileMenuOpen ? (
          <X className="h-6 w-6" />
        ) : (
          <Menu className="h-6 w-6" />
        )}
      </button>

      {/* Mobile Menu Dropdown */}
      {isMobileMenuOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[45] xl:hidden"
            onClick={() => setIsMobileMenuOpen(false)}
          />
          {/* Menu */}
          <nav className="absolute top-full left-4 right-4 mt-2 bg-background border border-border rounded-lg shadow-lg z-[60] xl:hidden">
            <div className="flex flex-col p-2">
              {navLinks.map(({ to, label }) => {
                const isSendPayment = to === '/send'
                const isDisabled = isSendPayment && !hasShieldedBalance
                
                return (
                  <NavLink
                    key={to}
                    to={isDisabled ? '#' : to}
                    onClick={(e) => handleNavLinkClick(isDisabled, e)}
                    className={({ isActive }) =>
                      cn(
                        'px-4 py-3 rounded-md text-sm transition-colors',
                        isDisabled
                          ? 'cursor-not-allowed opacity-50 text-muted-foreground'
                          : isActive
                          ? 'bg-accent/20 text-accent-foreground font-medium'
                          : 'text-muted-foreground hover:text-accent-foreground',
                      )
                    }
                    end={to === '/dashboard'}
                  >
                    {label}
                  </NavLink>
                )
              })}
            </div>
          </nav>
        </>
      )}
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

        {/* Settings Icon Button */}
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            cn(
              'flex items-center justify-center h-9 w-9 rounded-full transition-colors',
              isActive
                ? 'bg-muted-foreground/20 text-accent-foreground'
                : 'text-muted-foreground hover:bg-muted-foreground/10 hover:text-accent-foreground',
            )
          }
          aria-label="Settings"
          title="Settings"
        >
          <Settings className="h-6 w-6" />
        </NavLink>

        {/* TODO: Add chain selector, settings menu, and shielded sync controls. */}
      </div>
    </header>
  )
}
