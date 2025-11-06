import './index.css'
import { createRoot } from 'react-dom/client'
import { AppMain } from './app/main'

const container = document.getElementById('root')

if (!container) {
  throw new Error('Root element with id "root" was not found in the document.')
}

createRoot(container).render(<AppMain />)
