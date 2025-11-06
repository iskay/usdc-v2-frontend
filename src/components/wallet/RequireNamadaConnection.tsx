import { Shield } from 'lucide-react'
import { useWallet } from '@/hooks/useWallet'
import { Button } from '@/components/common/Button'

interface RequireNamadaConnectionProps {
  children: React.ReactNode
  message?: string
}

export function RequireNamadaConnection({ children, message }: RequireNamadaConnectionProps): JSX.Element {
  const { state, connectNamada } = useWallet()
  const isNamadaConnected = state.namada.isConnected

  if (isNamadaConnected) {
    return <>{children}</>
  }

  return (
    <div className="relative">
      {/* Blurred/ghosted content */}
      <div className="pointer-events-none select-none opacity-40 blur-sm" aria-hidden="true">
        {children}
      </div>

      {/* Overlay with connect prompt */}
      <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm">
        <div className="flex max-w-md flex-col items-center gap-6 rounded-lg border border-border bg-card p-8 shadow-lg">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <Shield className="h-8 w-8 text-muted-foreground" />
          </div>
          <div className="space-y-2 text-center">
            <h2 className="text-xl font-semibold">Namada Keychain Required</h2>
            <p className="text-sm text-muted-foreground">
              {message ??
                'Please connect your Namada Keychain to access this page. Shielded transactions require a connected wallet.'}
            </p>
          </div>
          <Button onClick={() => void connectNamada()} variant="primary" className="w-full">
            Connect Namada Keychain
          </Button>
        </div>
      </div>
    </div>
  )
}

