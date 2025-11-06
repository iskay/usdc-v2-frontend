import { useState, type FormEvent } from 'react'
import { DollarSign, Clock, X, Circle } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { useWallet } from '@/hooks/useWallet'
import { RequireMetaMaskConnection } from '@/components/wallet/RequireMetaMaskConnection'

export function Deposit() {
  const { state } = useWallet()
  const [amount, setAmount] = useState('123.00')
  const [fromAddress, setFromAddress] = useState(state.metaMask.account ?? '0x321abc123')
  const [selectedChain, setSelectedChain] = useState('Base')
  const [estimatedTime, setEstimatedTime] = useState('~20 mins')
  
  // TODO: Fetch actual available balance from connected wallet
  const availableBalance = '4000.20'
  const fee = '0.12'
  const total = (parseFloat(amount) + parseFloat(fee)).toFixed(2)

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    // TODO: Connect wallet service deposit orchestration with backend status polling.
  }

  return (
    <RequireMetaMaskConnection message="Please connect your MetaMask wallet to deposit USDC. EVM deposits require a connected wallet.">
      <div className="flex flex-col gap-6 p-24">

      {/* Amount Display Section */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-500">
          <DollarSign className="h-5 w-5 text-white" />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold">$</span>
          <input
            type="text"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-32 border-none bg-transparent p-0 text-3xl font-bold focus:outline-none focus:ring-0"
            placeholder="0.00"
            inputMode="decimal"
          />
          <span className="text-sm text-muted-foreground">of ${availableBalance}</span>
        </div>
      </div>

      <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
        {/* From Address Section */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-muted-foreground">from</label>
          <input
            type="text"
            value={fromAddress}
            onChange={(e) => setFromAddress(e.target.value)}
            className="rounded-lg border border-input bg-background px-4 py-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="0x..."
          />
        </div>

        {/* Network/Time Information Section */}
        <div className="flex items-center justify-center gap-3 rounded-lg border border-input bg-muted/40 px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-blue-500">
            <Circle className="h-4 w-4 text-blue-500" />
          </div>
          <span className="font-medium">{selectedChain}</span>
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">{estimatedTime}</span>
        </div>

        {/* Fee and Total Summary */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">fee: ${fee}</span>
            <button
              type="button"
              className="text-red-500 hover:text-red-600"
              aria-label="Remove fee"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div>
            <span className="text-sm font-medium">total: ${total}</span>
          </div>
        </div>

        {/* Action Button */}
        <Button type="submit" variant="primary" className="w-full py-6 text-lg">
          Deposit now
        </Button>
      </form>
    </div>
    </RequireMetaMaskConnection>
  )
}
