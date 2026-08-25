import type { Phoneme } from '../db'
import { PHONEME_LABEL } from '../practice/material'
import type { AttemptFeedback } from '../practice/feedback'
import { Button } from './Button'

/**
 * What one attempt measured, and every attempt so far.
 *
 * Two deliberate absences. There is no pass mark, because a threshold turns a
 * measurement into a verdict and the same recording would then be a failure
 * on one side of it and a success on the other. And there is no way to read
 * an unmeasured attempt as a low score: it shows a dash, not a zero, because
 * zero means "measured, and bad" and that is not what happened.
 *
 * The history is the reason any of this is encouraging. A learner looking at
 * 61 → 72 → 78 can see the thing that a single number cannot show them.
 */

interface AttemptRow {
  index: number
  similarity: number | null
  confidence: number | null
  assessed: boolean
  detected: string | null
  feedback: AttemptFeedback
}

const TONE: Record<AttemptFeedback['tone'], string> = {
  good: 'bg-good/10 border-good/30',
  close: 'bg-[var(--sound)]/8 border-[var(--sound)]/30',
  'keep-going': 'bg-paper-2 border-line',
  unmeasured: 'bg-paper-2 border-line',
}

function pct(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label-mono text-ink-faint">{label}</dt>
      <dd className="mt-1 text-3xl font-bold tabular-nums text-ink">{value}</dd>
    </div>
  )
}

export function AttemptResultPanel({
  phoneme,
  attempt,
  attempts,
  onRetry,
}: {
  phoneme: Phoneme
  attempt: AttemptRow
  attempts: AttemptRow[]
  onRetry: () => void
}) {
  const detected =
    attempt.detected === null
      ? 'Not enough to tell'
      : attempt.detected === phoneme
        ? PHONEME_LABEL[phoneme]
        : (PHONEME_LABEL[attempt.detected as Phoneme] ??
          `/${String(attempt.detected).toUpperCase()}/`)

  return (
    <section className="animate-rise" aria-live="polite">
      <div className="panel p-5 sm:p-6">
        <dl className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          <div>
            <dt className="label-mono text-ink-faint">Target</dt>
            <dd className="sound-text mt-1 font-mono text-3xl font-bold">
              {PHONEME_LABEL[phoneme]}
            </dd>
          </div>
          <div>
            <dt className="label-mono text-ink-faint">Your attempt</dt>
            <dd className="mt-1 font-mono text-3xl font-bold text-ink">{detected}</dd>
          </div>
          <Figure label="Practice similarity" value={pct(attempt.similarity)} />
          <Figure label="Confidence" value={pct(attempt.confidence)} />
        </dl>

        {!attempt.assessed && (
          <p className="label-mono mt-4 text-ink-faint">
            Nothing was measured from that recording — it is not a low score
          </p>
        )}

        <div className={`mt-5 rounded-2xl border-2 p-4 ${TONE[attempt.feedback.tone]}`}>
          <p className="text-lg font-semibold text-ink">{attempt.feedback.headline}</p>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">
            {attempt.feedback.detail}
          </p>
        </div>

        <div className="mt-5">
          <Button variant="outline" onClick={onRetry}>
            Try again
          </Button>
        </div>
      </div>

      {/* ── Attempt history ──────────────────────────────────── */}
      {attempts.length > 1 && (
        <div className="panel mt-4 p-5 sm:p-6">
          <h2 className="label-mono text-ink-faint">This session</h2>
          <ol className="mt-3">
            {attempts.map((row) => {
              const width = row.similarity === null ? 0 : Math.round(row.similarity * 100)
              return (
                <li
                  key={row.index}
                  className="flex items-center gap-4 border-b border-line py-2.5 last:border-b-0"
                >
                  <span className="label-mono w-20 shrink-0 text-ink-faint">
                    Attempt {row.index}
                  </span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-paper-2">
                    <span
                      className="block h-full rounded-full bg-[var(--sound)] transition-[width] duration-500"
                      style={{ width: `${width}%` }}
                    />
                  </span>
                  <span className="w-14 shrink-0 text-right text-lg font-bold tabular-nums text-ink">
                    {pct(row.similarity)}
                  </span>
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </section>
  )
}
