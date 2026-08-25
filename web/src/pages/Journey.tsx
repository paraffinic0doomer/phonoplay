import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { RecordingClip } from '../lib/recorder'
import { useCapture } from '../state/useCapture'
import {
  JourneyError,
  fetchJourney,
  fetchLanguages,
  requestMaterial,
  setNativeLanguage,
  submitJourneyAttempt,
} from '../lib/journey'
import type {
  JourneyAttemptResult,
  JourneyState,
  LanguageInfo,
  StageMaterial,
} from '../lib/journey'
import { SoundJourney } from '../components/SoundJourney'
import { BridgeStrip } from '../components/BridgeStrip'
import { LanguageBar, LanguagePicker } from '../components/LanguageBar'
import { AudioClipPlayer } from '../components/AudioClipPlayer'
import { RecordControl } from '../components/RecordControl'
import type { RecordStatus } from '../components/RecordButton'
import { ErrorNotice } from '../components/ErrorNotice'
import { Button } from '../components/Button'
import { Disclaimer, HowItWorks } from '../components/HowItWorks'
import { SOUND_PROFILES, isSoundId } from '../data/sounds'
import type { SoundId } from '../types/api'
import type { AppError } from '../state/session'

function toAppError(cause: unknown, fallback: string): AppError {
  if (cause instanceof JourneyError) {
    return { code: cause.code, message: cause.message, retryable: cause.retryable }
  }
  return { code: 'UNKNOWN', message: fallback, retryable: true }
}

/**
 * The Adaptive Sound Journey.
 *
 * One loop: read the stage, get material for it, record, submit, see what the
 * measurement decided. The screen deliberately shows those as separate
 * things — the exercise came from one place, the verdict from another — so a
 * learner can see that the progression follows from their recording and not
 * from whatever wrote the words.
 */
export function Journey() {
  const { sound } = useParams<{ sound: string }>()
  const soundId: SoundId | null = isSoundId(sound) ? sound : null
  const profile = soundId ? SOUND_PROFILES[soundId] : null

  const [journey, setJourney] = useState<JourneyState | null>(null)
  const [material, setMaterial] = useState<StageMaterial | null>(null)
  const [result, setResult] = useState<JourneyAttemptResult | null>(null)
  const [status, setStatus] = useState<RecordStatus>('idle')
  const [clip, setClip] = useState<RecordingClip | null>(null)
  const [error, setError] = useState<AppError | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [nativeOptions, setNativeOptions] = useState<LanguageInfo[]>([])
  // The picker is opened deliberately. It stays closed by default so that
  // English-only use never has to acknowledge a language question it does
  // not have.
  const [pickerOpen, setPickerOpen] = useState(false)
  const [switching, setSwitching] = useState(false)

  // Set while a request is in flight so an unmount cannot write state. The
  // recorder has its own equivalent inside useCapture; this one covers the
  // journey and material fetches.
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // The same device owner Practice uses. Journey keeps its status locally
  // rather than in the session reducer, so the hook reports transitions here.
  const { recorderRef: recorder, start: handleStart, stop: handleStop } = useCapture({
    onPermissionRequest: () => {
      setError(null)
      setResult(null)
      setStatus('requesting-permission')
    },
    onRecordingStart: () => setStatus('recording'),
    onClip: (recorded) => {
      setClip(recorded)
      setStatus('review')
    },
    onError: (failure) => {
      setError(failure)
      setStatus('error')
    },
  })

  const loadMaterial = useCallback(
    async (target: SoundId, avoid?: string | null) => {
      setGenerating(true)
      try {
        const next = await requestMaterial(target, { avoid })
        if (!alive.current) return
        setMaterial(next.material)
        // The microphone is only enabled once there is something to say.
        // RecordButton treats 'idle' as "not ready yet", so staying there
        // would leave the button permanently disabled.
        setStatus((current) => (current === 'idle' ? 'ready' : current))
      } catch (cause) {
        if (!alive.current) return
        // Material generation has a server-side fallback bank, so reaching
        // here means the service itself is unreachable.
        setError(toAppError(cause, 'Could not load an exercise.'))
      } finally {
        if (alive.current) setGenerating(false)
      }
    },
    [],
  )

  // The language list is static and small; fetched once on mount so opening
  // the picker is instant.
  useEffect(() => {
    let cancelled = false
    fetchLanguages()
      .then((body) => {
        if (!cancelled) setNativeOptions(body.native)
      })
      .catch(() => {
        // Not fatal: without the list the picker simply is not offered, and
        // practice continues in whatever language is already set.
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function chooseLanguage(code: string) {
    if (!soundId) return
    setSwitching(true)
    try {
      await setNativeLanguage(code)
      // Re-read rather than patching local state: the bridge and the material
      // both depend on the choice, and the server is the one that resolves an
      // unrecognised code.
      const refreshed = await fetchJourney(soundId)
      if (!alive.current) return
      setJourney(refreshed)
      setPickerOpen(false)
      await loadMaterial(soundId)
    } catch (cause) {
      if (alive.current) setError(toAppError(cause, 'Could not change the language.'))
    } finally {
      if (alive.current) setSwitching(false)
    }
  }

  useEffect(() => {
    if (!soundId) return
    let cancelled = false

    setLoading(true)
    setError(null)
    setResult(null)
    setClip(null)
    setStatus('idle')

    fetchJourney(soundId)
      .then((state) => {
        if (cancelled) return
        setJourney(state)
        return loadMaterial(soundId)
      })
      .catch((cause) => {
        if (cancelled) return
        setError(toAppError(cause, 'Could not load your journey.'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [soundId, loadMaterial])

  async function handleSubmit() {
    if (!clip || !soundId || !material) return
    setStatus('processing')
    setError(null)

    try {
      const submitted = await submitJourneyAttempt(soundId, clip, material.item.text)
      if (!alive.current) return

      setResult(submitted)
      setJourney(submitted.journey)
      setStatus('success')

      // The policy says whether the next exercise should differ. A hold on
      // mixed results asks for new words; a hint asks for the same one again.
      if (submitted.decision.vary_material || submitted.decision.action === 'advance') {
        await loadMaterial(soundId, material.item.text)
      }
    } catch (cause) {
      if (!alive.current) return
      setError(toAppError(cause, 'Could not send that recording.'))
      setStatus('error')
    }
  }

  function reset() {
    setClip(null)
    setResult(null)
    setError(null)
    setStatus(material ? 'ready' : 'idle')
  }

  if (!soundId || !profile) {
    return (
      <main className="mx-auto max-w-2xl px-5 py-16 text-center">
        <h1 className="text-3xl font-bold text-ink">That sound has no journey.</h1>
        <p className="mt-3 text-ink-soft">Pick one of the four target sounds to begin.</p>
        <Link to="/sounds" className="mt-6 inline-block">
          <Button>Choose a sound</Button>
        </Link>
      </main>
    )
  }

  // After an advance or retreat the stage changes before the replacement
  // exercise arrives. Showing the previous word under the new stage heading
  // would be actively wrong — "A short word" above a syllable — so the panel
  // says it is working instead, and the microphone waits.
  const staleMaterial = Boolean(material && journey && material.stage !== journey.stage.index)

  const moving =
    result?.decision.action === 'advance'
      ? 'advance'
      : result?.decision.action === 'retreat'
        ? 'retreat'
        : 'none'

  return (
    <main
      className="mx-auto max-w-3xl px-5 py-8 sm:py-12"
      style={{ ['--sound' as string]: profile.color }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="label-mono text-ink-faint">Sound Journey</p>
          <h1 className="mt-1 text-4xl font-bold text-ink">
            {profile.display}
          </h1>
        </div>
        <Link
          to="/sounds"
          className="label-mono flex min-h-11 items-center text-ink-faint underline sm:min-h-0"
        >
          Change sound
        </Link>
      </div>

      {loading && (
        <p className="mt-8 text-ink-soft" aria-live="polite">
          Loading your journey…
        </p>
      )}

      {journey && (
        <div className="mt-6 flex flex-col gap-5">
          <LanguageBar
            language={journey.language}
            sound={soundId}
            onChange={nativeOptions.length > 1 ? () => setPickerOpen((open) => !open) : undefined}
          />

          {(pickerOpen || (!journey.language.cross_language && nativeOptions.length > 1)) && (
            <LanguagePicker
              options={nativeOptions}
              current={journey.language.native.code}
              onSelect={chooseLanguage}
              busy={switching}
            />
          )}

          {journey.language.bridge && <BridgeStrip bridge={journey.language.bridge} />}

          <SoundJourney bands={journey.bands} stage={journey.stage} moving={moving} />
        </div>
      )}

      {error && (
        <div className="mt-6">
          <ErrorNotice error={error} onRetry={error.retryable ? reset : undefined} />
        </div>
      )}

      {/* ── The exercise ────────────────────────────────────────── */}
      {journey && material && (
        <section className="panel mt-6 p-6 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="label-mono text-ink-faint">Say this</h2>
            <span className="label-mono text-ink-faint">
              {material.source === 'llm' ? 'generated for you' : 'practice bank'}
            </span>
          </div>

          {staleMaterial ? (
            <p className="mt-3 text-3xl font-bold leading-tight text-ink-faint">
              Preparing your next exercise…
            </p>
          ) : (
            <p className="mt-3 text-5xl font-bold leading-tight text-ink">
              {material.item.display ?? material.item.text}
            </p>
          )}

          {!staleMaterial && material.item.contrast && (
            <p className="mt-2 text-sm text-ink-soft">
              Not{' '}
              <span className="font-semibold text-ink">
                “{material.item.contrast}”
              </span>{' '}
              — listen for the difference.
            </p>
          )}

          {!staleMaterial && (
            <p className="mt-4 rounded-2xl bg-paper-2 p-4 text-sm leading-relaxed text-ink-soft">
              {material.item.cue}
            </p>
          )}

          {!staleMaterial && material.first_occurrence_only && (
            <p className="label-mono mt-3 text-ink-faint">
              Measured on the first {profile.display} in what you say.
            </p>
          )}

          {generating && !staleMaterial && (
            <p className="label-mono mt-3 text-ink-faint" aria-live="polite">
              Preparing the next exercise…
            </p>
          )}
        </section>
      )}

      {/* ── Recording ───────────────────────────────────────────── */}
      {journey && material && (
        <section className="mt-6 flex flex-col items-center gap-4">
          {status === 'review' && clip ? (
            <div className="w-full max-w-md">
              <AudioClipPlayer
                blob={clip.blob}
                peaks={clip.peaks}
                durationS={clip.durationS}
                label="Your recording"
              />
              <div className="mt-4 flex flex-wrap justify-center gap-3">
                <Button onClick={handleSubmit}>Use this recording</Button>
                <Button variant="ghost" onClick={reset}>
                  Record again
                </Button>
              </div>
            </div>
          ) : (
            <RecordControl
              recorderRef={recorder}
              status={staleMaterial ? 'processing' : status}
              onStart={handleStart}
              onStop={handleStop}
            />
          )}
        </section>
      )}

      {/* ── What the microphone measured, and what it changed ───── */}
      {result && (
        <section className="panel mt-8 p-6 sm:p-7">
          <h2 className="label-mono text-ink-faint">What we measured</h2>

          <p className="mt-3 text-lg font-semibold text-ink">
            {result.analysis.message}
          </p>

          {!result.analysis.assessed && result.analysis.detail && (
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              {result.analysis.detail}
            </p>
          )}

          {result.analysis.assessed ? (
            <>
              {/* The two percentages answer different questions, and shown as
                  bare "Similarity / Confidence" they read as competing scores
                  — a low match beside a high confidence looks contradictory.
                  Each label now names what its number is about, and the line
                  underneath spells out the pairing for this specific result. */}
              <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4 sm:grid-cols-4">
                <div>
                  <dt className="label-mono text-ink-faint">
                    {/* `.ipa` opts out of label-mono's uppercase transform.
                        IPA is case-sensitive, so /θ/ rendered as /Θ/ is not a
                        styling quirk — it is a different symbol. */}
                    Match to <span className="ipa">/{result.analysis.target_ipa}/</span>
                  </dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
                    {(result.analysis.similarity_score * 100).toFixed(0)}%
                  </dd>
                </div>
                <div>
                  <dt className="label-mono text-ink-faint">Heard as</dt>
                  <dd className="mt-0.5 text-sm font-semibold text-ink">
                    /{result.analysis.estimated_match_ipa}/
                  </dd>
                </div>
                <div>
                  <dt className="label-mono text-ink-faint">Sure of that</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
                    {(result.analysis.confidence * 100).toFixed(0)}%
                  </dd>
                </div>
                <div>
                  <dt className="label-mono text-ink-faint">Took</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
                    {result.analysis.processing_ms}ms
                  </dd>
                </div>
              </dl>

              <p className="mt-3 text-xs leading-relaxed text-ink-soft">
                {result.analysis.estimated_match === result.analysis.target_phoneme ? (
                  <>
                    <strong className="font-semibold text-ink">
                      {(result.analysis.similarity_score * 100).toFixed(0)}%
                    </strong>{' '}
                    is how close this came to a clear /{result.analysis.target_ipa}/.{' '}
                    <strong className="font-semibold text-ink">
                      {(result.analysis.confidence * 100).toFixed(0)}%
                    </strong>{' '}
                    is how sure we are of that reading.
                  </>
                ) : (
                  <>
                    <strong className="font-semibold text-ink">
                      {(result.analysis.similarity_score * 100).toFixed(0)}%
                    </strong>{' '}
                    is how close this came to /{result.analysis.target_ipa}/ — the
                    sound you were asked for.{' '}
                    <strong className="font-semibold text-ink">
                      {(result.analysis.confidence * 100).toFixed(0)}%
                    </strong>{' '}
                    is how sure we are it was /
                    {result.analysis.estimated_match_ipa}/ instead. A low match
                    with high certainty means the recording was clear — and
                    clearly a different sound.
                  </>
                )}
              </p>
            </>
          ) : (
            <p className="mt-4 rounded-2xl bg-paper-2 p-4 text-sm leading-relaxed text-ink-soft">
              No score is shown because none was produced. The recording did
              not support one.
            </p>
          )}

          {result.analysis.cue && (
            <p className="mt-4 rounded-2xl bg-paper-2 p-4 text-sm leading-relaxed text-ink-soft">
              <strong className="font-semibold text-ink">Try this. </strong>
              {result.analysis.cue}
            </p>
          )}

          {result.decision.show_hint && result.decision.hint && (
            <p className="mt-3 rounded-2xl border border-line bg-paper p-4 text-sm leading-relaxed text-ink-soft">
              <strong className="font-semibold text-ink">Before you retry. </strong>
              {result.decision.hint}
            </p>
          )}

          <p
            className={`mt-5 border-t border-line pt-4 text-sm font-semibold ${
              result.decision.action === 'advance'
                ? 'text-good'
                : result.decision.action === 'retreat'
                  ? 'text-warn'
                  : 'text-ink-soft'
            }`}
            aria-live="polite"
          >
            {result.decision.reason}
          </p>

          <p className="label-mono mt-4 text-ink-faint">
            The exercise is written by AI. This measurement is not — it comes
            from the recording.
          </p>

          {/* Shown next to the number, not only in the footer. This is the
              moment someone is most likely to read more into a percentage
              than it can carry. */}
          <Disclaimer className="mt-2" />

          <div className="mt-5">
            <Button onClick={reset}>Next attempt</Button>
          </div>
        </section>
      )}

      <div className="mt-10">
        <HowItWorks compact />
      </div>
    </main>
  )
}
