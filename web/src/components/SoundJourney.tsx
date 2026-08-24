import type { JourneyBand, JourneyStage } from '../lib/journey'

/**
 * SOUND JOURNEY — the five-dot progression.
 *
 *     ● Sound  ● Word  ● Phrase  ● Sentence  ○ Conversation
 *
 * Filled dots are ground covered, the ring marks where the learner is now,
 * and hollow dots are still ahead. Seven stages would be too many to read at
 * a glance, so two of them share the "Sound" band; the caption underneath
 * names the actual stage so nothing is hidden by the grouping.
 *
 * The bands come from the API rather than being written here, so the display
 * cannot drift out of step with the stages the backend is actually using.
 *
 * Accessibility: rendered as an ordered list with a text status, so the
 * progression is available to a screen reader as a sequence rather than as
 * decoration. Movement is announced politely via `aria-live` on the caption.
 */
export function SoundJourney({
  bands,
  stage,
  moving = 'none',
  compact = false,
}: {
  bands: JourneyBand[]
  stage: JourneyStage
  /** Direction of the last change, used only to tint the caption. */
  moving?: 'advance' | 'retreat' | 'none'
  compact?: boolean
}) {
  const current = stage.band_index

  return (
    <section
      className={compact ? '' : 'panel p-5 sm:p-6'}
      aria-labelledby="sound-journey-heading"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="sound-journey-heading" className="label-mono text-ink-faint">
          Sound Journey
        </h2>
        <span className="label-mono text-ink-faint">
          Stage {stage.index} of 7
        </span>
      </div>

      <ol className="mt-4 flex items-start justify-between gap-1" role="list">
        {bands.map((band) => {
          const done = band.index < current
          const active = band.index === current

          return (
            <li
              key={band.band}
              className="relative flex min-w-0 flex-1 flex-col items-center gap-2"
              aria-current={active ? 'step' : undefined}
            >
              {/* The connector sits behind the dot and stops at the last
                  band, so the track never trails off into nothing. */}
              {band.index < bands.length - 1 && (
                <span
                  aria-hidden="true"
                  className={`absolute left-1/2 top-[11px] h-0.5 w-full ${
                    done ? 'bg-[var(--sound)]' : 'bg-line'
                  }`}
                />
              )}

              <span
                aria-hidden="true"
                className={`relative z-10 grid h-[22px] w-[22px] place-items-center rounded-full border-2 transition-all duration-300 ${
                  active
                    ? 'border-[var(--sound)] bg-paper scale-110'
                    : done
                      ? 'border-[var(--sound)] bg-[var(--sound)]'
                      : 'border-line-strong bg-paper'
                }`}
              >
                {active && (
                  <span className="h-2.5 w-2.5 rounded-full bg-[var(--sound)] animate-[breathe_2.6s_ease-in-out_infinite]" />
                )}
              </span>

              <span
                className={`text-center text-[0.7rem] leading-tight sm:text-xs ${
                  active
                    ? 'font-semibold text-ink'
                    : done
                      ? 'text-ink-soft'
                      : 'text-ink-faint'
                }`}
              >
                {band.label}
              </span>
              <span className="sr-only">
                {done ? 'completed' : active ? 'current stage' : 'not started'}
              </span>
            </li>
          )
        })}
      </ol>

      <p
        aria-live="polite"
        className={`mt-4 border-t border-line pt-3 text-sm ${
          moving === 'advance'
            ? 'text-good'
            : moving === 'retreat'
              ? 'text-warn'
              : 'text-ink-soft'
        }`}
      >
        <span className="font-semibold text-ink">{stage.title}.</span>{' '}
        {stage.instruction}
      </p>
    </section>
  )
}
