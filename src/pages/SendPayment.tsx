import { useState, type FormEvent } from 'react'
import { DollarSign, Clock, X, Circle } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { RequireNamadaConnection } from '@/components/wallet/RequireNamadaConnection'

export function SendPayment() {
  const [amount, setAmount] = useState('123.00')
  const [toAddress, setToAddress] = useState('0x321abc123')
  const [selectedChain, setSelectedChain] = useState('Base')
  const [estimatedTime, setEstimatedTime] = useState('~90 sec')
  
  // TODO: Fetch actual shielded balance from Namada SDK
  const shieldedBalance = '356.20'
  const fee = '0.12'
  const total = (parseFloat(amount) + parseFloat(fee)).toFixed(2)

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    // TODO: Integrate cross-chain payment submission leveraging txBuilder + txSubmitter services.
  }

  return (
    <RequireNamadaConnection message="Please connect your Namada Keychain to send payments. Shielded payments require a connected wallet.">
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
          <span className="text-sm text-muted-foreground">of ${shieldedBalance}</span>
        </div>
      </div>

      <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
        {/* To Address Section */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-muted-foreground">to</label>
          <input
            type="text"
            value={toAddress}
            onChange={(e) => setToAddress(e.target.value)}
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
          </div>
          <div>
            <span className="text-sm font-medium">total: ${total}</span>
          </div>
        </div>

        {/* Action Button */}
        <Button type="submit" variant="primary" className="w-full py-6 text-lg">
          Pay now
        </Button>
      </form>
    </div>
    </RequireNamadaConnection>
  )
}
