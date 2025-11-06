import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'

const links = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/deposit', label: 'Deposit' },
  { to: '/send', label: 'Send Payment' },
  { to: '/history', label: 'Transaction History' },
]

export function Sidebar() {
  return (
    <aside className="hidden w-64 flex-col border-r border-border bg-sidebar p-6 text-sm md:flex">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">USDC Bridge</h1>
        <p className="text-muted-foreground">EVM ↔ Namada orchestration</p>
      </div>
      <nav className="flex flex-col gap-1">
        {links.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'rounded-md px-3 py-2 font-medium transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                isActive ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'text-muted-foreground',
              )
            }
            end={to === '/dashboard'}
          >
            {label}
          </NavLink>
        ))}
      </nav>
      {/* TODO: Add network health, balances summary, and quick links. */}
    </aside>
  )
}
