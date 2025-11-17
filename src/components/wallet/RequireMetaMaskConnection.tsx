import React from 'react'
import { Wallet } from 'lucide-react'
import { useWallet } from '@/hooks/useWallet'
import { Button } from '@/components/common/Button'

interface RequireMetaMaskConnectionProps {
  children: React.ReactNode
  message?: string
}

export function RequireMetaMaskConnection({ children, message }: RequireMetaMaskConnectionProps): React.JSX.Element {
  const { state, connectMetaMask, isMetaMaskAvailable } = useWallet()
  const isMetaMaskConnected = state.metaMask.isConnected

  if (isMetaMaskConnected) {
    return <>{children}</>
  }

  return (
    <div className="relative">
      {/* Blurred/ghosted content */}
      <div className="pointer-events-none select-none opacity-40 blur-sm" aria-hidden="true">
        {children}
      </div>

      {/* Overlay with connect prompt */}
      <div className="absolute inset-0 flex items-start justify-center pt-20 bg-background/80 backdrop-blur-sm">
        <div className="flex max-w-md flex-col items-center gap-6 rounded-lg border border-border bg-card p-8 shadow-lg">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <Wallet className="h-8 w-8 text-muted-foreground" />
          </div>
          <div className="space-y-2 text-center">
            <h2 className="text-xl font-semibold">MetaMask Required</h2>
            <p className="text-sm text-muted-foreground">
              {message ??
                'Please connect your MetaMask wallet to access this page. EVM deposits require a connected wallet.'}
            </p>
          </div>
          <Button
            onClick={() => void connectMetaMask()}
            variant="primary"
            className="w-full"
            disabled={!isMetaMaskAvailable}
          >
            {isMetaMaskAvailable ? 'Connect MetaMask' : 'MetaMask Not Detected'}
          </Button>
        </div>
      </div>
    </div>
  )
}

