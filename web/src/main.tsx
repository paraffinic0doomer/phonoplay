import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App'

/*
 * Dev-only handle on the persistence layer.
 *
 * `import.meta.env.DEV` is statically false in a production build, so the
 * whole block — and the import it pulls in — is removed by tree shaking and
 * never reaches a shipped bundle. It exists so the database can be inspected
 * and reset from the browser console while building, and so the browser test
 * harness can drive the service layer against real IndexedDB.
 */
if (import.meta.env.DEV) {
  void import('./db').then((phonoplayDb) => {
    ;(globalThis as unknown as Record<string, unknown>).phonoplayDb = phonoplayDb
  })
}

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element in index.html')

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
