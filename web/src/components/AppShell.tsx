import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { isFixtureActive, onFixtureStateChange } from '../lib/api'
import { DISCLAIMER, PRIVACY_SUMMARY } from '../lib/safety'

function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="flex size-9 items-center justify-center rounded-xl bg-ink text-paper"
      >
        <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
          <path
            d="M2 11h2.2M6.4 6.2v9.6M10.6 3v16M14.8 7.4v7.2M19 9.6v2.8"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span className="text-lg font-bold tracking-tight text-ink">PhonoPlay</span>
    </span>
  )
}

// min-h-11 is 44px: the smallest reliable touch target. The links were
// 36px tall, which is comfortable with a mouse and fiddly with a thumb.
// Height is only forced on small screens so the desktop header keeps its
// proportions.
const navLink = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-11 items-center rounded-full px-3 text-sm font-semibold transition-colors sm:min-h-0 sm:px-4 sm:py-2 ${
    isActive ? 'bg-ink text-paper' : 'text-ink-soft hover:bg-paper-2 hover:text-ink'
  }`

export function AppShell({ children }: { children: ReactNode }) {
  // Driven by whether the fallback has actually served a value, not by
  // whether it is permitted. See lib/api.ts.
  const [fallbackActive, setFallbackActive] = useState(isFixtureActive)
  useEffect(() => onFixtureStateChange(setFallbackActive), [])

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-5 focus:py-3 focus:text-paper"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-line bg-paper/85 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3 sm:gap-4 sm:px-6">
          {/* The wordmark block is 36px tall; the link around it gets the
              44px touch minimum on small screens like every other nav item. */}
          <Link
            to="/"
            aria-label="PhonoPlay home"
            className="flex min-h-11 items-center sm:min-h-0"
          >
            <Wordmark />
          </Link>

          <nav aria-label="Main" className="flex items-center gap-1">
            <NavLink to="/sounds" className={navLink}>
              Sounds
            </NavLink>
            <NavLink to="/progress" className={navLink}>
              Progress
            </NavLink>
            <NavLink to="/games" className={navLink}>
              Play
            </NavLink>
          </nav>
        </div>

        {fallbackActive && (
          <p
            role="status"
            className="label-mono border-t border-warn/25 bg-warn/10 px-4 py-1.5 text-center text-warn"
          >
            Offline demo data — the analysis service is unreachable
          </p>
        )}
      </header>

      <main id="main" className="flex-1">
        {children}
      </main>

      <footer className="border-t border-line px-4 py-8 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 text-sm text-ink-faint">
          {/* The exact promised wording, from lib/safety.ts. Written once
              there so the interface and the API cannot drift apart. */}
          <p className="max-w-prose leading-relaxed">{DISCLAIMER}</p>
          <p className="max-w-prose leading-relaxed">{PRIVACY_SUMMARY}</p>
          <p className="label-mono">Built for the sound lab</p>
        </div>
      </footer>
    </div>
  )
}
