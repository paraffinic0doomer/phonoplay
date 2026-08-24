import type { CSSProperties } from 'react'
import type { AttemptResult, SoundId } from '../types/api'
import { SOUND_PROFILES, ipaToDisplay } from '../data/sounds'
import { MouthDiagram } from './MouthDiagram'
import { AudioClipPlayer } from './AudioClipPlayer'

function toSoundId(ipa: string): SoundId | null {
  if (ipa === 's') return 's'
  if (ipa === 'ɹ' || ipa === 'r') return 'r'
  if (ipa === 'l') return 'l'
  if (ipa === 'θ' || ipa === 'ð') return 'th'
  return null
}

function SoundFace({
  caption,
  display,
  soundId,
  tone,
}: {
  caption: string
  display: string
  soundId: SoundId | null
  tone: 'target' | 'attempt'
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center text-center">
      <span className="label-mono text-ink-faint">{caption}</span>
      <span
        className={`mt-1 font-mono text-4xl font-semibold sm:text-5xl ${
          tone === 'target' ? 'sound-text' : 'text-ink'
        }`}
      >
        {display}
      </span>
      <div className={`mt-3 w-24 sm:w-28 ${tone === 'target' ? 'sound-text' : 'text-ink-soft'}`}>
        {soundId ? (
          <MouthDiagram sound={soundId} />
        ) : (
          <div className="flex h-[68px] items-center justify-center rounded-xl bg-paper-2 text-xs text-ink-faint">
            no diagram
          </div>
        )}
      </div>
    </div>
  )
}

function SpectrumStrip({
  centroid,
  sibilantRatio,
  tone,
}: {
  centroid: number | null
  sibilantRatio: number | null
  tone: 'target' | 'attempt'
}) {
  const centre = centroid ?? 0
  const high = sibilantRatio ?? 0
  const bars = Array.from({ length: 18 }, (_, index) => {
    const frequency = 500 + index * 500
    const distance = Math.abs(frequency - centre) / 4000
    return Math.max(0.12, Math.min(1, 1 - distance * 0.7 + high * (index / 18) * 0.55))
  })
  return (
    <div className="mt-3" role="img" aria-label="Simplified spectral shape of the analyzed sound">
      <div className="flex h-16 items-end gap-1 rounded-xl bg-paper-2 px-3 py-2">
        {bars.map((height, index) => (
          <span
            key={index}
            className={`min-w-0 flex-1 origin-bottom rounded-full ${tone === 'target' ? 'sound-bg' : 'bg-ink'}`}
            style={{ height: `${Math.round(height * 100)}%`, opacity: tone === 'target' ? 0.72 : 0.5 }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[0.65rem] text-ink-faint">
        <span>low</span>
        <span>high frequency</span>
      </div>
    </div>
  )
}

const TARGET_SPECTRA: Record<SoundId, { centroid: number; ratio: number }> = {
  s: { centroid: 6200, ratio: 0.58 },
  r: { centroid: 1800, ratio: 0.08 },
  l: { centroid: 2200, ratio: 0.1 },
  th: { centroid: 3500, ratio: 0.25 },
}

interface SoundCompareProps {
  result: AttemptResult
  waveform: number[]
  /** In-memory clip. Null after a reload. */
  audio: Blob | null
}

/**
 * Side-by-side comparison of the sound the learner was aiming for and the
 * sound the analysis actually measured, backed by the model's own phoneme
 * probabilities and the learner's real waveform.
 */
export function SoundCompare({ result, waveform, audio }: SoundCompareProps) {
  const occurrence = result.target_analysis.occurrences[0]
  const targetIpa = result.target_analysis.target_phoneme
  const heard = occurrence?.observed_top ?? []
  const topIpa = heard[0]?.phoneme ?? targetIpa
  const onTarget = topIpa === targetIpa

  const duration = result.audio_quality.duration_s || 1
  const highlight = occurrence
    ? {
        from: Math.max(0, occurrence.start_s / duration),
        to: Math.min(1, occurrence.end_s / duration),
      }
    : undefined

  const profile = SOUND_PROFILES[result.prompt.target_sound]
  const targetSpectrum = TARGET_SPECTRA[result.prompt.target_sound]

  return (
    <section
      style={{ '--sound': profile.color } as CSSProperties}
      className="panel animate-rise p-6 sm:p-8"
    >
      <h2 className="label-mono text-ink-faint">Sound comparison</h2>

      <div className="mt-5 flex items-start gap-3 sm:gap-6">
        <SoundFace
          caption="Target"
          display={ipaToDisplay(targetIpa)}
          soundId={result.prompt.target_sound}
          tone="target"
        />

        <div className="flex flex-col items-center self-center pt-6">
          <span
            aria-hidden="true"
            className={`flex size-10 items-center justify-center rounded-full text-sm font-bold ${
              onTarget ? 'bg-good/15 text-good' : 'bg-paper-2 text-ink-faint'
            } ${!onTarget ? 'animate-pulse' : ''}`}
          >
            {onTarget ? '✓' : 'vs'}
          </span>
        </div>

        <SoundFace
          caption="Your attempt"
          display={ipaToDisplay(topIpa)}
          soundId={toSoundId(topIpa)}
          tone="attempt"
        />
      </div>

      <div className="mt-7 grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
        <div>
          <h3 className="label-mono text-ink-faint">Target sound spectrum</h3>
          <SpectrumStrip centroid={targetSpectrum.centroid} sibilantRatio={targetSpectrum.ratio} tone="target" />
        </div>
        <div className={!onTarget ? 'animate-rise' : ''}>
          <h3 className="label-mono text-ink-faint">Your sound spectrum</h3>
          <SpectrumStrip centroid={result.acoustic_features.spectral_centroid_hz} sibilantRatio={result.acoustic_features.sibilant_ratio} tone="attempt" />
        </div>
      </div>

      {/* The model's own phoneme probabilities over the target segment. */}
      {heard.length > 0 && (
        <div className="mt-7 border-t border-line pt-5">
          <h3 className="label-mono text-ink-faint">
            What the analysis measured in that slice
          </h3>
          <ul className="mt-3 space-y-2">
            {heard.map((observation) => {
              const isTarget = observation.phoneme === targetIpa
              const percent = Math.round(observation.prob * 100)
              return (
                <li key={observation.phoneme} className="flex items-center gap-3">
                  <span
                    className={`w-14 shrink-0 font-mono text-sm font-semibold ${
                      isTarget ? 'sound-text' : 'text-ink-soft'
                    }`}
                  >
                    {ipaToDisplay(observation.phoneme)}
                  </span>
                  <span className="h-3 flex-1 overflow-hidden rounded-full bg-paper-2">
                    <span
                      className={`block h-full rounded-full ${
                        isTarget ? 'sound-bg' : 'bg-ink-faint'
                      }`}
                      style={{ width: `${Math.max(percent, 2)}%` }}
                    />
                  </span>
                  <span className="w-10 shrink-0 text-right text-sm tabular-nums text-ink-soft">
                    {percent}%
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* The learner's real audio. */}
      <div className="mt-7 border-t border-line pt-5">
        <h3 className="label-mono text-ink-faint">
          Your recording
          {occurrence && (
            <span className="ml-2 normal-case tracking-normal">
              — the darker slice is the {ipaToDisplay(targetIpa)} sound
            </span>
          )}
        </h3>
        <div className="sound-text mt-3">
          <AudioClipPlayer
            blob={audio}
            peaks={waveform}
            durationS={duration}
            highlight={highlight}
          />
        </div>
      </div>

      {!onTarget && (
        <p className="mt-5 rounded-xl sound-tint px-4 py-3 text-sm font-semibold text-ink animate-rise">
          Target: {ipaToDisplay(targetIpa)} <span className="mx-2 text-ink-faint">→</span> Your attempt: {ipaToDisplay(topIpa)}
        </p>
      )}
    </section>
  )
}
