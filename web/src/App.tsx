import { Suspense, lazy, useEffect } from 'react'
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

/*
 * Onboarding is the only route that touches the database, so importing it
 * eagerly pulled Dexie into the first-paint bundle — 108 kB to 146 kB
 * gzipped for a screen most learners see once. Split out, the landing page
 * stays as light as it was and the flow loads while they read the question.
 */
const Onboarding = lazy(() =>
  import('./pages/Onboarding').then((m) => ({ default: m.Onboarding })),
)
const Assessment = lazy(() =>
  import('./pages/Assessment').then((m) => ({ default: m.Assessment })),
)
const PracticeEngine = lazy(() =>
  import('./pages/PracticeEngine').then((m) => ({ default: m.PracticeEngine })),
)

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
          <Route
            path="/onboarding"
            element={
              <Suspense
                fallback={
                  <p className="mx-auto max-w-2xl px-5 py-16 text-ink-soft" aria-live="polite">
                    Getting started…
                  </p>
                }
              >
                <Onboarding />
              </Suspense>
            }
          />
          <Route path="/assessment" element={<Assessment />} />
          <Route path="/sounds" element={<SoundSelect />} />
          <Route path="/practice/:sound" element={<PracticeEngine />} />
          {/* The older single-attempt flow. Still the producer for /results,
              /progress and /games, which read session state rather than the
              learner model. */}
          <Route path="/attempt/:sound" element={<Practice />} />
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
