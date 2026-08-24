import type { AttemptResult } from '../types/api'
import { ipaToDisplay } from '../data/sounds'
import { ConfidenceMeter } from './ScoreDial'

/** Plain-language names for the evidence keys the backend returns. */
const EVIDENCE_COPY: Record<string, string> = {
  posterior_argmax: 'the sound the acoustic model measured',
  feature_rule: 'the acoustic shape of that slice',
  transcript_mismatch: 'the word the transcriber heard',
  transcript_match: 'the word the transcriber heard',
  f3_not_lowered: 'tongue position (F3 stayed high)',
  f3_high: 'tongue position (F3 stayed high)',
  low_gop: 'a low match score across the slice',
}

const HEADLINE: Record<string, string> = {
  none: 'On target',
  substitution: 'A different sound came out',
  distortion: 'Right sound, not quite clear',
  omission: 'The sound was missing',
  unclear: 'Could not place that sound',
  inconclusive: 'The signals disagreed',
}

/**
 * Names the pronunciation pattern, and — just as importantly — shows what it
 * was based on. `inconclusive` is a real, expected outcome, not a failure.
 */
export function DeviationCard({ result }: { result: AttemptResult }) {
  const { deviation } = result
  const onTarget = deviation.type === 'none'
  const uncertain = deviation.type === 'inconclusive' || deviation.type === 'unclear'

  return (
    <section className="panel p-6 sm:p-7">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`flex size-9 items-center justify-center rounded-full text-base font-bold ${
            onTarget
              ? 'bg-good/15 text-good'
              : uncertain
                ? 'bg-paper-2 text-ink-faint'
                : 'sound-tint-strong sound-text'
          }`}
          aria-hidden="true"
        >
          {onTarget ? '✓' : uncertain ? '?' : '!'}
        </span>
        <h2 className="text-xl font-semibold text-ink">
          {HEADLINE[deviation.type] ?? 'Pronunciation pattern'}
        </h2>
      </div>

      {deviation.type === 'substitution' && deviation.from && deviation.to && (
        <p className="mt-4 flex flex-wrap items-center gap-2 font-mono text-2xl font-semibold">
          <span className="sound-text">{ipaToDisplay(deviation.from)}</span>
          <span aria-hidden="true" className="text-ink-faint">
            →
          </span>
          <span className="text-ink">{ipaToDisplay(deviation.to)}</span>
        </p>
      )}

      <p className="mt-3 text-[0.95rem] leading-relaxed text-ink-soft">
        {deviation.explanation}
      </p>

      {uncertain && (
        <p className="mt-3 rounded-2xl bg-paper-2 p-4 text-sm leading-relaxed text-ink-soft">
          The signals did not agree well enough to name a single pattern. Recording again
          in a quieter spot usually resolves it.
        </p>
      )}

      <div className="mt-6 border-t border-line pt-5">
        <ConfidenceMeter value={deviation.confidence} />
      </div>

      {deviation.evidence.length > 0 && (
        <div className="mt-5">
          <h3 className="label-mono text-ink-faint">Based on</h3>
          <ul className="mt-2 space-y-1.5">
            {deviation.evidence.map((key) => (
              <li key={key} className="flex items-start gap-2 text-sm text-ink-soft">
                <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-ink-faint" />
                {EVIDENCE_COPY[key] ?? key.replace(/_/g, ' ')}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
