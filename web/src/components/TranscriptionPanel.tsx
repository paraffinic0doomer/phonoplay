import type { TranscriptionResponse } from '../types/api'

/**
 * STAGE 1 — what the speech-to-text service heard.
 *
 * Presented as its own panel, visibly separate from the pronunciation
 * analysis, because it is a different measurement answering a different
 * question. Whisper is a language model: it repairs mispronunciations toward
 * plausible English, so a clean transcript does not mean a clean /r/. The
 * copy here says so rather than leaving the learner to infer it.
 */
export function TranscriptionPanel({
  transcription,
  expected,
}: {
  transcription: TranscriptionResponse
  expected: string
}) {
  const heard = transcription.transcript.trim()
  const normalise = (value: string) => value.toLowerCase().replace(/[^a-z]/g, '')
  const matches = heard.length > 0 && normalise(heard) === normalise(expected)
  const { processing, audio } = transcription

  return (
    <section className="panel p-6 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="label-mono text-ink-faint">Stage 1 · Transcription</h2>
        <span className="label-mono text-ink-faint">
          {processing.provider} · {processing.model}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="label-mono text-ink-faint">Heard</span>
        {heard ? (
          <span className="text-3xl font-bold text-ink">“{heard}”</span>
        ) : (
          <span className="text-2xl font-semibold text-ink-faint">
            no words detected
          </span>
        )}
        {heard.length > 0 && (
          <span
            className={`label-mono rounded-full px-2.5 py-1 ${
              matches ? 'bg-good/12 text-good' : 'bg-paper-2 text-ink-soft'
            }`}
          >
            {matches ? 'matches the prompt' : `prompt was “${expected}”`}
          </span>
        )}
      </div>

      {/* Word timings, when the provider returned them. */}
      {transcription.segments.some((segment) => segment.words.length > 0) && (
        <ul className="mt-4 flex flex-wrap gap-2">
          {transcription.segments.flatMap((segment) =>
            segment.words.map((word, index) => (
              <li
                key={`${segment.id}-${word.word}-${index}`}
                className="rounded-lg bg-paper-2 px-3 py-1.5"
              >
                <span className="text-sm font-semibold text-ink">{word.word}</span>
                {word.start !== null && word.end !== null && (
                  <span className="label-mono ml-2 text-ink-faint">
                    {word.start.toFixed(2)}–{word.end.toFixed(2)}s
                  </span>
                )}
              </li>
            )),
          )}
        </ul>
      )}

      <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4 sm:grid-cols-4">
        <div>
          <dt className="label-mono text-ink-faint">Language</dt>
          <dd className="mt-0.5 text-sm font-semibold text-ink">
            {transcription.language ?? '—'}
            {transcription.language_code && (
              <span className="ml-1 font-normal text-ink-faint">
                ({transcription.language_code})
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="label-mono text-ink-faint">Duration</dt>
          <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
            {transcription.duration?.toFixed(2) ?? '—'}s
          </dd>
        </div>
        <div>
          <dt className="label-mono text-ink-faint">Sent as</dt>
          <dd className="mt-0.5 text-sm font-semibold text-ink">
            {(audio.sample_rate / 1000).toFixed(0)} kHz
            {audio.channels === 1 ? ' mono' : ` ${audio.channels}ch`}
          </dd>
        </div>
        <div>
          <dt className="label-mono text-ink-faint">Took</dt>
          <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
            {processing.transcription_ms}ms
          </dd>
        </div>
      </dl>

      <p className="mt-4 rounded-2xl bg-paper-2 p-4 text-xs leading-relaxed text-ink-soft">
        <strong className="font-semibold text-ink">This is not a pronunciation
        score.</strong>{' '}
        Speech-to-text reports which words it recognised. It corrects
        mispronunciations toward real English words, so it cannot tell you how a
        sound was produced — that is measured separately in stage 2.
      </p>
    </section>
  )
}
