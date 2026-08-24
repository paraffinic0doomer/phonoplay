import type { AttemptResult } from '../types/api'

/**
 * Per-phoneme accuracy across the word, from the backend's aligned GOP values.
 * Every bar is a measurement of one aligned segment — nothing here is inferred
 * on the client.
 */
export function PhonemeTimeline({ result }: { result: AttemptResult }) {
  const segments = result.phoneme_timeline
  if (segments.length === 0) return null

  const targetIndices = new Set(
    result.target_analysis.occurrences.map((occurrence) => occurrence.index),
  )

  return (
    <section className="panel p-6 sm:p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="label-mono text-ink-faint">Sound by sound</h2>
        <span className="text-xs text-ink-faint">Taller is closer to target</span>
      </div>

      <ol className="mt-5 flex items-end gap-1.5 sm:gap-2">
        {segments.map((segment, index) => {
          const isTarget = targetIndices.has(index)
          const percent = Math.round(segment.gop_normalized * 100)
          return (
            <li
              key={`${segment.phoneme}-${index}`}
              className="flex min-w-0 flex-1 flex-col items-center gap-2"
              title={`${segment.phoneme}: ${percent}% · ${segment.start_s.toFixed(2)}–${segment.end_s.toFixed(2)}s`}
            >
              <span className="text-xs font-semibold tabular-nums text-ink-faint">
                {percent}
              </span>
              <span
                className="flex w-full items-end justify-center rounded-t-lg bg-paper-2"
                style={{ height: 96 }}
              >
                <span
                  className={`w-full rounded-t-lg transition-[height] duration-500 ${
                    isTarget ? 'sound-bg' : 'bg-line-strong'
                  }`}
                  style={{ height: `${Math.max(6, percent)}%` }}
                />
              </span>
              <span
                className={`font-mono text-sm ${
                  isTarget ? 'sound-text font-bold' : 'text-ink-soft'
                }`}
              >
                {segment.phoneme}
              </span>
            </li>
          )
        })}
      </ol>

      <p className="mt-4 border-t border-line pt-4 text-xs leading-relaxed text-ink-faint">
        Bars show Goodness of Pronunciation for each aligned sound in{' '}
        <span className="font-semibold text-ink-soft">“{result.prompt.text}”</span>. The
        highlighted bar is your target sound.
      </p>
    </section>
  )
}
