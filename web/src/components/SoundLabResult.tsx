import type { Phoneme, PhonemeProfile } from '../db'
import type { PronunciationMeasurement } from '../types/api'
import { ipaToDisplay } from '../data/sounds'
import { SIMILARITY_CAVEAT, SIMILARITY_LABEL, AFTER_LABEL, beforeLabel, deriveBeforeAfter } from '../lab/lab'
import { chartCandidates, readFeatures, segmentHighlight, zOffset } from '../lab/features'
import { PHONEME_LABEL } from '../practice/material'
import { AudioClipPlayer } from './AudioClipPlayer'
import { MouthDiagram } from './MouthDiagram'

function Percent({ value }: { value: number | null }) {
  return <>{value === null ? '—' : `${Math.round(value * 100)}%`}</>
}

function BeforeAfter({ profile }: { profile: PhonemeProfile }) {
  const comparison = deriveBeforeAfter(profile)
  if (!comparison) return null

  return (
    <section className="mt-6 rounded-2xl bg-paper-2 p-4 sm:p-5">
      <p className="label-mono text-ink-faint">Your practice change</p>
      <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-end gap-3">
        <div>
          <p className="text-sm text-ink-soft">{beforeLabel(comparison)}</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-ink"><Percent value={comparison.first} /></p>
        </div>
        <span aria-hidden="true" className="pb-2 text-ink-faint">→</span>
        <div>
          <p className="text-sm text-ink-soft">{AFTER_LABEL}</p>
          <p className="mt-1 text-3xl font-bold tabular-nums sound-text"><Percent value={comparison.current} /></p>
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-ink-faint">{SIMILARITY_CAVEAT}</p>
    </section>
  )
}

function Evidence({ result }: { result: PronunciationMeasurement }) {
  const candidates = chartCandidates(result)
  const target = result.candidates.find((candidate) => candidate.phoneme === result.target_phoneme)
  const readings = readFeatures(target?.z_scores ?? {}, result.acoustic_features, 3)
  if (!candidates.length && !readings.length) return null

  return (
    <details className="mt-6 border-t border-line pt-5">
      <summary className="cursor-pointer text-sm font-semibold text-ink">See the acoustic details</summary>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">
        These readings come directly from the measured part of this recording. They are reference comparisons, not anatomy or a clinical assessment.
      </p>
      {candidates.length > 0 && (
        <div className="mt-5">
          <p className="label-mono text-ink-faint">Pattern comparison</p>
          <div className="mt-3 space-y-2">
            {candidates.map((candidate) => {
              const value = Math.round(candidate.posterior * 100)
              return <div key={candidate.phoneme} className="flex items-center gap-3">
                <span className="w-14 font-mono text-sm font-semibold text-ink">{ipaToDisplay(candidate.phoneme)}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-paper-2"><span className="block h-full rounded-full sound-bg" style={{ width: `${Math.max(value, 2)}%`, opacity: candidate.phoneme === result.target_phoneme ? 1 : .45 }} /></span>
                <span className="w-10 text-right text-sm tabular-nums text-ink-soft">{value}%</span>
              </div>
            })}
          </div>
        </div>
      )}
      {readings.length > 0 && (
        <div className="mt-6">
          <p className="label-mono text-ink-faint">Measured features</p>
          <div className="mt-3 space-y-4">
            {readings.map((reading) => <div key={reading.key}>
              <div className="flex justify-between gap-3 text-sm"><span className="text-ink">{reading.label}</span><span className="shrink-0 tabular-nums text-ink-soft">{reading.formatted ?? 'Measured'}</span></div>
              <div className="relative mt-2 h-2 rounded-full bg-paper-2"><span className="absolute left-1/2 top-[-3px] h-3.5 w-px bg-ink-faint" aria-hidden="true" /><span className="absolute top-0 size-2 rounded-full sound-bg" style={{ left: `calc(${zOffset(reading.z) * 100}% - 4px)` }} /></div>
              <p className="mt-1 text-xs text-ink-faint">{reading.band}</p>
            </div>)}
          </div>
        </div>
      )}
    </details>
  )
}

export function SoundLabResult({ phoneme, profile, result, peaks, blob, durationS, accessibility }: {
  phoneme: Phoneme
  profile: PhonemeProfile
  result: PronunciationMeasurement
  peaks: number[]
  blob: Blob
  durationS: number
  accessibility: boolean
}) {
  const detected = result.estimated_match ? ipaToDisplay(result.estimated_match) : 'Not enough to tell'
  const highlight = segmentHighlight(result.segment, durationS) ?? undefined
  const cue = result.cue ?? result.hint ?? 'Try the sound once more, slowly and comfortably.'

  if (accessibility) return <section className="panel animate-rise p-5 sm:p-6" aria-live="polite">
    <p className="label-mono text-ink-faint">Your next small step</p>
    <div className="mt-4 flex items-start gap-4"><span className="sound-text w-20 shrink-0"><MouthDiagram sound={phoneme} /></span><div><p className="text-2xl font-bold sound-text">{PHONEME_LABEL[phoneme]}</p><p className="mt-1 text-sm leading-relaxed text-ink-soft">{cue}</p></div></div>
    <div className="mt-6 border-t border-line pt-5"><p className="label-mono text-ink-faint">Listen back</p><div className="sound-text mt-3"><AudioClipPlayer blob={blob} peaks={peaks} durationS={durationS} highlight={highlight} label="Play your recording" /></div></div>
    <p className="mt-6 text-lg font-semibold text-ink">{result.message}</p>
    <p className="mt-2 text-sm leading-relaxed text-ink-soft">Detected pattern: {detected}. {SIMILARITY_LABEL}: <Percent value={result.assessed ? result.similarity_score : null} />.</p>
    <BeforeAfter profile={profile} />
    <Evidence result={result} />
  </section>

  return <section className="panel animate-rise p-5 sm:p-6" aria-live="polite">
    <div className="flex items-start justify-between gap-5"><div><p className="label-mono text-ink-faint">Sound Lab · measured from your recording</p><h2 className="mt-2 text-2xl font-bold text-ink">Your sound, made visible</h2></div><span className="sound-text w-20 shrink-0"><MouthDiagram sound={phoneme} /></span></div>
    <dl className="mt-6 grid grid-cols-2 gap-x-5 gap-y-6 sm:grid-cols-5"><div><dt className="label-mono text-ink-faint">Target</dt><dd className="mt-1 font-mono text-3xl font-bold sound-text">{PHONEME_LABEL[phoneme]}</dd></div><div><dt className="label-mono text-ink-faint">Your attempt</dt><dd className="mt-1 font-mono text-2xl font-bold text-ink">{detected}</dd></div><div><dt className="label-mono text-ink-faint">Detected pattern</dt><dd className="mt-2 text-sm font-semibold text-ink">{result.feedback_code.replaceAll('_', ' ')}</dd></div><div><dt className="label-mono text-ink-faint">{SIMILARITY_LABEL}</dt><dd className="mt-1 text-3xl font-bold tabular-nums text-ink"><Percent value={result.assessed ? result.similarity_score : null} /></dd></div><div><dt className="label-mono text-ink-faint">Confidence</dt><dd className="mt-1 text-3xl font-bold tabular-nums text-ink"><Percent value={result.assessed ? result.confidence : null} /></dd></div></dl>
    <p className="mt-6 rounded-2xl sound-tint p-4 text-sm leading-relaxed text-ink">{result.message} <span className="font-semibold">Cue:</span> {cue}</p>
    <div className="mt-6 border-t border-line pt-5"><p className="label-mono text-ink-faint">Your waveform</p><div className="sound-text mt-3"><AudioClipPlayer blob={blob} peaks={peaks} durationS={durationS} highlight={highlight} /></div></div>
    <BeforeAfter profile={profile} />
    <Evidence result={result} />
  </section>
}
