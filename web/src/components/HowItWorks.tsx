import { useState } from 'react'
import {
  AUDIO_HANDLING,
  DISCLAIMER,
  HOW_IT_WORKS,
  NOT_CLAIMED,
  PRIVACY_SUMMARY,
} from '../lib/safety'

/**
 * "How PhonoPlay works" — the four steps, compact.
 *
 * Deliberately compact and deliberately not hidden behind a link. Someone
 * about to read a percentage about a child's speech should be able to see, in
 * one glance, that a language model wrote the exercise and a measurement
 * produced the number — and that the number is not a diagnosis.
 *
 * The privacy and limits detail sits behind a disclosure, because it is long
 * and most people will not want it every time. The disclaimer above it never
 * is.
 */
export function HowItWorks({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false)

  return (
    <section className="panel p-5 sm:p-6" aria-labelledby="how-it-works-heading">
      <h2 id="how-it-works-heading" className="label-mono text-ink-faint">
        How PhonoPlay works
      </h2>

      <ol className={`mt-4 grid gap-4 ${compact ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-4'}`}>
        {HOW_IT_WORKS.map((step) => (
          <li key={step.step} className="flex gap-3">
            <span
              aria-hidden="true"
              className="label-mono mt-0.5 shrink-0 text-ink-faint"
            >
              {String(step.step).padStart(2, '0')}
            </span>
            <div>
              <h3 className="text-sm font-semibold leading-snug text-ink">{step.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-ink-soft">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-5 rounded-2xl bg-paper-2 p-4 text-sm font-semibold leading-relaxed text-ink">
        {DISCLAIMER}
      </p>

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="label-mono mt-4 text-ink-faint underline underline-offset-2 hover:text-ink"
      >
        {open ? 'Hide' : 'Your recordings, and what this cannot do'}
      </button>

      {open && (
        <div className="mt-4 flex flex-col gap-4 border-t border-line pt-4">
          <div>
            <h3 className="label-mono text-ink-faint">Your recordings</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">{PRIVACY_SUMMARY}</p>
            <ul className="mt-3 flex flex-col gap-2">
              {AUDIO_HANDLING.map((stage) => (
                <li key={stage.label} className="text-xs leading-relaxed text-ink-soft">
                  <span className="font-semibold text-ink">{stage.label}</span>
                  <span
                    className={`label-mono ml-2 rounded-full px-2 py-0.5 ${
                      stage.audioLeavesBrowser
                        ? 'bg-warn/12 text-warn'
                        : 'bg-good/12 text-good'
                    }`}
                  >
                    {stage.audioLeavesBrowser ? 'audio leaves your browser' : 'no audio is sent'}
                  </span>
                  <span className="mt-1 block">{stage.detail}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="label-mono text-ink-faint">What this cannot do</h3>
            <ul className="mt-2 flex flex-col gap-1.5">
              {NOT_CLAIMED.map((limit) => (
                <li key={limit} className="text-xs leading-relaxed text-ink-soft">
                  {limit}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  )
}

/**
 * The disclaimer on its own, for places that show a result but have no room
 * for the full explanation.
 */
export function Disclaimer({ className = '' }: { className?: string }) {
  return (
    <p className={`text-xs leading-relaxed text-ink-soft ${className}`}>
      {DISCLAIMER}
    </p>
  )
}
