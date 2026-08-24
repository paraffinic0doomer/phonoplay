import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { SessionProvider } from './state/session'
import { AppShell } from './components/AppShell'
import { Landing } from './pages/Landing'
import { SoundSelect } from './pages/SoundSelect'
import { Practice } from './pages/Practice'
import { Results } from './pages/Results'
import { Progress } from './pages/Progress'
import { NotFound } from './pages/NotFound'
import { Games } from './pages/Games'
import { Journey } from './pages/Journey'

/** Routing does not move the viewport on its own; do it here. */
function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [pathname])
  return null
}

export default function App() {
  return (
    <SessionProvider>
      <ScrollToTop />
      <AppShell>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/sounds" element={<SoundSelect />} />
          <Route path="/practice/:sound" element={<Practice />} />
          <Route path="/journey/:sound" element={<Journey />} />
          <Route path="/results" element={<Results />} />
          <Route path="/progress" element={<Progress />} />
          <Route path="/games" element={<Games />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AppShell>
    </SessionProvider>
  )
}
