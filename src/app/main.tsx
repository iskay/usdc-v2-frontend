import { StrictMode } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { Provider as JotaiProvider } from 'jotai'
import { jotaiStore } from '@/store/jotaiStore'
import { AppRoutes } from './routes'
import { AppBootstrap } from './AppBootstrap'

export function AppMain() {
  return (
    <StrictMode>
      <JotaiProvider store={jotaiStore}>
        <BrowserRouter>
          <AppBootstrap>
            <AppRoutes />
          </AppBootstrap>
        </BrowserRouter>
      </JotaiProvider>
    </StrictMode>
  )
}
