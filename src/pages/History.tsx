import { useState } from 'react'
import { AlertBox } from '@/components/common/AlertBox'
import { Button } from '@/components/common/Button'
import { TxHistoryList } from '@/components/tx/TxHistoryList'

const FILTERS = ['all', 'deposits', 'payments'] as const

export function History() {
  const [activeFilter, setActiveFilter] = useState<(typeof FILTERS)[number]>('all')

  return (
    <div className="space-y-6 p-24">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Transaction History</h1>
        <p className="text-muted-foreground">
          Review deposits, payments, and shielded sync activity across your connected accounts.
        </p>
      </header>
      <AlertBox tone="info" title="Filter & export roadmap">
        TODO: Hook this view into backend history endpoints and add CSV export + advanced filtering.
      </AlertBox>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((filter) => (
          <Button
            key={filter}
            variant={activeFilter === filter ? 'primary' : 'ghost'}
            onClick={() => setActiveFilter(filter)}
          >
            {filter === 'all' ? 'All Activity' : filter === 'deposits' ? 'Deposits' : 'Payments'}
          </Button>
        ))}
        <Button variant="ghost" className="ml-auto">
          Export History
        </Button>
      </div>
      <TxHistoryList />
    </div>
  )
}
