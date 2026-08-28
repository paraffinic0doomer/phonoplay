import { Suspense, lazy, useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { SessionProvider } from './state/session'
import { AppShell } from './components/AppShell'
import { Landing } from './pages/Landing'

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
const ContrastLab = lazy(() =>
  import('./pages/ContrastLab').then((m) => ({ default: m.ContrastLab })),
)
const PracticeEngine = lazy(() =>
  import('./pages/PracticeEngine').then((m) => ({ default: m.PracticeEngine })),
)
const SoundSelect = lazy(() => import('./pages/SoundSelect').then((m) => ({ default: m.SoundSelect })))
const Practice = lazy(() => import('./pages/Practice').then((m) => ({ default: m.Practice })))
const Results = lazy(() => import('./pages/Results').then((m) => ({ default: m.Results })))
const Progress = lazy(() => import('./pages/Progress').then((m) => ({ default: m.Progress })))
const NotFound = lazy(() => import('./pages/NotFound').then((m) => ({ default: m.NotFound })))
const Games = lazy(() => import('./pages/Games').then((m) => ({ default: m.Games })))
const Plan = lazy(() => import('./pages/Plan').then((m) => ({ default: m.Plan })))
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })))

/** Routing does not move the viewport on its own; do it here. */
function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [pathname])
  return null
}

function RouteFallback() {
  return <main className="mx-auto max-w-2xl px-5 py-16"><p className="label-mono text-ink-faint" aria-live="polite">Opening PhonoPlay…</p></main>
}

export default function App() {
  return (
    <SessionProvider>
      <ScrollToTop />
      <AppShell>
        <Suspense fallback={<RouteFallback />}>
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
          <Route path="/contrast" element={<ContrastLab />} />
          <Route path="/contrast/:contrast" element={<ContrastLab />} />
          <Route path="/sounds" element={<SoundSelect />} />
          <Route path="/plan" element={<Plan />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/practice/:sound" element={<PracticeEngine />} />
          {/* The older single-attempt flow. Still the producer for /results,
              /progress and /games, which read session state rather than the
              learner model. */}
          <Route path="/attempt/:sound" element={<Practice />} />
          <Route path="/results" element={<Results />} />
          <Route path="/progress" element={<Progress />} />
          <Route path="/games" element={<Games />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
      </AppShell>
    </SessionProvider>
  )
}
