import { lazy } from 'react'
import type { RouteObject } from 'react-router-dom'
import { useRoutes } from 'react-router-dom'
import { App } from './App'

const DashboardPage = lazy(async () => ({
  default: (await import('@/pages/Dashboard')).Dashboard,
}))
const SendPaymentPage = lazy(async () => ({
  default: (await import('@/pages/SendPayment')).SendPayment,
}))
const DepositPage = lazy(async () => ({
  default: (await import('@/pages/Deposit')).Deposit,
}))
const HistoryPage = lazy(async () => ({
  default: (await import('@/pages/History')).History,
}))

const routes: RouteObject[] = [
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'send', element: <SendPaymentPage /> },
      { path: 'deposit', element: <DepositPage /> },
      { path: 'history', element: <HistoryPage /> },
    ],
  },
]

export function AppRoutes() {
  return useRoutes(routes)
}
