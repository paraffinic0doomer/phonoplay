import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { MAX_CLIP_MS } from '../lib/recorder'
import type { RecordingClip } from '../lib/recorder'
import { measurePronunciation } from '../lib/api'
import { useCapture } from '../state/useCapture'
import { RecordButton, useElapsed } from '../components/RecordButton'
import type { RecordStatus } from '../components/RecordButton'
import { RecordingReview } from '../components/RecordingReview'
import { ErrorNotice } from '../components/ErrorNotice'
import { Button, ButtonLink } from '../components/Button'
import { MouthDiagram } from '../components/MouthDiagram'
import { SOUND_PROFILES } from '../data/sounds'
import type { SoundId } from '../types/api'
import { speak, speakPair, speechAvailable, stopSpeaking } from '../assessment/speech'
import {
  CONTRASTS,
  STEP_LABEL,
  STEP_PURPOSE,
  getContrast,
  stepsFor,
} from '../contrast/pairs'
import type { Contrast, LabStep } from '../contrast/pairs'
import {
  accuracy,
  accuracyIsMeaningful,
  discriminationFeedback,
  productionFeedback,
  spokenTask,
  trialAt,
} from '../contrast/lab'
import type { LabMessage } from '../contrast/lab'
import { getContrastProfile, recordContrastResult, recordMeasurement } from '../db'
import type { ContrastProfile } from '../db'

/**
 * The Sound Contrast Lab.
 *
 * Two sounds, and the two separate skills of telling them apart and producing
 * them distinctly. Listening trials are scored by the learner's own answer;
 * spoken ones by `POST /api/pronunciation`. Neither invents anything: a pair
 * with no measurable side is offered for listening only, and says so.
 *
 * Educational practice. Not a screener, and nothing here reports anything
 * about a learner beyond how their answers and recordings compared.
 */

type Phase = 'prompt' | 'answered' | 'review' | 'measuring'

/* ── Choosing a pair ──────────────────────────────────────────────── */

function ContrastPicker() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-10 sm:py-14">
      <p className="label-mono text-ink-faint">Sound Contrast Lab</p>
      <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-ink sm:text-4xl">
        Two sounds, side by side
      </h1>
      <p className="mt-4 text-base leading-relaxed text-ink-soft">
        Pairs that sit close together acoustically. Hearing the difference and
        making it are separate skills, so the lab practises both — where it can
        measure both.
      </p>

      <ul className="mt-8 flex list-none flex-col gap-3">
        {CONTRASTS.map((contrast) => (
          <li key={contrast.id}>
            <ButtonLink
              to={`/contrast/${contrast.id}`}
              variant="outline"
              size="lg"
              className="w-full justify-start"
            >
              <span className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-mono text-2xl font-semibold">
                  {contrast.a.label} / {contrast.b.label}
                </span>
                <span className="label-mono text-ink-faint">
                  {contrast.modes.includes('speak')
                    ? 'listening and speaking'
                    : 'listening only'}
                </span>
              </span>
            </ButtonLink>
          </li>
        ))}
      </ul>

      <p className="mt-8 text-sm leading-relaxed text-ink-faint">
        These pairs are here because they are acoustically close and PhonoPlay
        can tell them apart — not because they are claimed to be difficult for
        any particular group of people. This is pronunciation practice, not a
        screening tool.
      </p>
    </main>
  )
}

/* ── The lab ──────────────────────────────────────────────────────── */

export function ContrastLab() {
  const { contrast: contrastId } = useParams()
  const navigate = useNavigate()

  const contrast = contrastId ? getContrast(contrastId) : undefined
  if (!contrastId) return <ContrastPicker />
  if (!contrast) return <ContrastPicker />

  return <Lab contrast={contrast} onLeave={() => navigate('/contrast')} />
}

function Lab({ contrast, onLeave }: { contrast: Contrast; onLeave: () => void }) {
  const steps = useMemo(() => stepsFor(contrast), [contrast])

  const [stepIndex, setStepIndex] = useState(0)
  const [trialIndex, setTrialIndex] = useState(0)
  const [phase, setPhase] = useState<Phase>('prompt')
  const [message, setMessage] = useState<LabMessage | null>(null)
  const [clip, setClip] = useState<RecordingClip | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [level, setLevel] = useState(0)
  const [speaking, setSpeaking] = useState(false)
  const [error, setError] = useState<{ code: string; message: string; retryable: boolean } | null>(
    null,
  )
  const [stored, setStored] = useState<ContrastProfile | null>(null)
  const [measured, setMeasured] = useState<{
    similarity: number
    confidence: number
    detected: string | null
    assessed: boolean
  } | null>(null)

  const step: LabStep = steps[stepIndex]
  const trial = useMemo(() => trialAt(contrast, trialIndex), [contrast, trialIndex])
  const task = useMemo(() => spokenTask(contrast, step, trialIndex), [contrast, step, trialIndex])

  const elapsed = useElapsed(capturing)

  /* Running accuracy for this pair, from what is already stored. */
  useEffect(() => {
    let alive = true
    const side = contrast.a.target ?? contrast.b.target ?? 's'
    void getContrastProfile(contrast.id, side as never).then((profile) => {
      if (alive) setStored(profile)
    })
    return () => {
      alive = false
      stopSpeaking()
    }
  }, [contrast])

  const { recorderRef, start, stop, support } = useCapture({
    // Set here rather than on the click: the button must not offer "stop"
    // until the device is genuinely open.
    onRecordingStart: () => {
      setError(null)
      setCapturing(true)
    },
    onClip: (captured) => {
      setCapturing(false)
      setClip(captured)
      setPhase('review')
    },
    onError: (failure) => {
      setCapturing(false)
      setError(failure)
    },
  })

  useEffect(() => {
    if (!capturing) return
    let frame = 0
    const tick = () => {
      setLevel(recorderRef.current?.level() ?? 0)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [capturing, recorderRef])

  useEffect(() => {
    if (!capturing) return
    const id = window.setTimeout(() => void stop(), MAX_CLIP_MS)
    return () => window.clearTimeout(id)
  }, [capturing, stop])

  const hear = useCallback(async (text: string, pair?: string) => {
    setSpeaking(true)
    await (pair ? speakPair(text, pair) : speak(text))
    setSpeaking(false)
  }, [])

  const nextStep = useCallback(() => {
    stopSpeaking()
    setMessage(null)
    setMeasured(null)
    setClip(null)
    setError(null)
    setPhase('prompt')
    setStepIndex((current) => Math.min(current + 1, steps.length - 1))
  }, [steps.length])

  const again = useCallback(() => {
    stopSpeaking()
    setMessage(null)
    setMeasured(null)
    setClip(null)
    setError(null)
    setPhase('prompt')
    setTrialIndex((current) => current + 1)
  }, [])

  /* ── Listening: the learner's answer is the measurement ─────────── */
  const answer = useCallback(
    async (side: 'a' | 'b') => {
      const correct = side === trial.answer
      const heard = trial.answer === 'a' ? contrast.a : contrast.b
      setMessage(discriminationFeedback(correct, heard))
      setPhase('answered')

      // Straight into the learner model. `correct` is derived inside the db
      // layer from response === target, so the stored answer and the stored
      // judgement cannot disagree.
      const profile = await recordContrastResult({
        contrast: contrast.id,
        phoneme: (contrast.a.target ?? contrast.b.target ?? 's') as never,
        correct,
      })
      setStored(profile)
    },
    [contrast, trial],
  )

  /* ── Speaking: the analyser measures it ─────────────────────────── */
  const submit = useCallback(async () => {
    if (!clip || !task) return
    if (!task.measured) {
      // Practice only. Nothing is sent and nothing is recorded.
      nextStep()
      return
    }

    setPhase('measuring')
    setError(null)
    try {
      const result = await measurePronunciation({
        clip,
        targetSound: task.side.target as string,
        expectedText: task.text,
      })
      setMeasured({
        similarity: result.similarity_score,
        confidence: result.confidence,
        detected: result.estimated_match,
        assessed: result.assessed,
      })
      setMessage(
        productionFeedback({
          contrast,
          side: task.side,
          similarity: result.assessed ? result.similarity_score : null,
          detected: result.estimated_match,
          assessed: result.assessed,
        }),
      )
      // The same measurement the rest of the product uses.
      await recordMeasurement({
        phoneme: task.side.target as never,
        similarity: result.assessed ? result.similarity_score : null,
        confidence: result.assessed ? result.confidence : null,
        assessed: result.assessed,
      })
      setPhase('answered')
    } catch (cause) {
      setError({
        code:
          cause && typeof cause === 'object' && 'code' in cause
            ? String((cause as { code: unknown }).code)
            : 'UNKNOWN',
        message: cause instanceof Error ? cause.message : 'Could not measure that recording.',
        retryable: true,
      })
      setPhase('review')
    }
  }, [clip, task, contrast, nextStep])

  const accent = (contrast.a.target ?? contrast.b.target ?? 'th') as SoundId
  const soundProfile = SOUND_PROFILES[accent]
  const isLast = stepIndex === steps.length - 1
  const runningAccuracy = accuracy(stored?.correctAttempts ?? 0, stored?.attempts ?? 0)

  const recordStatus: RecordStatus =
    support !== 'ok'
      ? 'blocked'
      : phase === 'measuring'
        ? 'processing'
        : phase === 'review'
          ? 'review'
          : capturing
            ? 'recording'
            : 'ready'

  return (
    <main
      style={{ '--sound': soundProfile.color } as CSSProperties}
      className="mx-auto max-w-2xl px-5 py-8 sm:py-12"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="label-mono text-ink-faint">Sound Contrast Lab</p>
          <h1 className="sound-text mt-1 font-mono text-4xl font-bold tracking-tight">
            {contrast.a.label} / {contrast.b.label}
          </h1>
        </div>
        <span className="sound-text w-14 shrink-0">
          <MouthDiagram sound={accent} />
        </span>
      </div>

      {/* Progression */}
      <ol
        className="mt-6 flex gap-1"
        aria-label={`Step ${stepIndex + 1} of ${steps.length}: ${STEP_LABEL[step]}`}
      >
        {steps.map((item, position) => (
          <li
            key={item}
            aria-current={position === stepIndex ? 'step' : undefined}
            className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
              position < stepIndex
                ? 'bg-ink'
                : position === stepIndex
                  ? 'bg-[var(--sound)]'
                  : 'bg-line'
            }`}
          />
        ))}
      </ol>
      <div className="mt-2 flex items-baseline justify-between">
        <span className="label-mono text-ink-faint">
          {STEP_LABEL[step]} — step {stepIndex + 1} of {steps.length}
        </span>
        {runningAccuracy !== null && accuracyIsMeaningful(stored?.attempts ?? 0) && (
          <span className="label-mono text-ink-faint">
            listening {runningAccuracy}% · {stored?.attempts} answers
          </span>
        )}
      </div>

      <p className="mt-6 text-base leading-relaxed text-ink-soft">{STEP_PURPOSE[step]}</p>

      {contrast.speakingNote && (
        <p className="mt-4 rounded-2xl bg-paper-2 p-4 text-sm leading-relaxed text-ink-soft">
          {contrast.speakingNote}
        </p>
      )}

      {error && (
        <div className="mt-6">
          <ErrorNotice
            error={error}
            onDismiss={() => setError(null)}
            onRetry={clip ? () => void submit() : undefined}
            retryLabel="Send again"
          />
          <div className="mt-3">
            <Button variant="ghost" onClick={nextStep}>
              Skip this one and carry on
            </Button>
          </div>
        </div>
      )}

      <div key={`${step}-${trialIndex}`} className="animate-rise mt-8">
        {/* ── Listen ──────────────────────────────────────────── */}
        {step === 'listen' && (
          <div>
            <p className="text-lg leading-relaxed text-ink">{contrast.difference}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button
                variant="sound"
                size="lg"
                disabled={speaking || !speechAvailable()}
                onClick={() => void hear(contrast.words[0].a, contrast.words[0].b)}
              >
                {speaking ? 'Playing…' : `Hear ${contrast.words[0].a} / ${contrast.words[0].b}`}
              </Button>
              <Button variant="outline" size="lg" onClick={nextStep}>
                Continue
              </Button>
            </div>
            {!speechAvailable() && (
              <p className="mt-4 text-sm leading-relaxed text-ink-soft">
                This browser has no built-in voice, so there is nothing to play.
                The mouth diagram and the description above still show where each
                sound is made.
              </p>
            )}
          </div>
        )}

        {/* ── Discriminate ────────────────────────────────────── */}
        {step === 'discriminate' && (
          <div>
            <Button
              variant="outline"
              size="lg"
              disabled={speaking || !speechAvailable()}
              onClick={() => void hear(trial.word)}
            >
              {speaking ? 'Playing…' : phase === 'prompt' ? 'Play the word' : 'Play it again'}
            </Button>

            <p className="mt-6 text-lg font-semibold text-ink">Which sound did you hear?</p>
            <div
              role="radiogroup"
              aria-label="Which sound did you hear?"
              className="mt-3 flex flex-wrap gap-3"
            >
              {(['a', 'b'] as const).map((side) => {
                const option = side === 'a' ? contrast.a : contrast.b
                const revealed = phase === 'answered'
                const isAnswer = side === trial.answer
                return (
                  <button
                    key={side}
                    type="button"
                    role="radio"
                    aria-checked={revealed && isAnswer}
                    disabled={revealed}
                    onClick={() => void answer(side)}
                    className={`rounded-2xl border-2 px-8 py-5 font-mono text-2xl font-bold transition-colors ${
                      revealed && isAnswer
                        ? 'border-good bg-good/10 text-ink'
                        : 'border-line bg-paper text-ink hover:border-line-strong'
                    }`}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>

            {phase === 'answered' && (
              <div className="animate-rise mt-6">
                <p className="text-sm leading-relaxed text-ink-soft">
                  The pair: <strong className="text-ink">{trial.pair.a}</strong> /{' '}
                  <strong className="text-ink">{trial.pair.b}</strong>
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Button
                    variant="outline"
                    disabled={speaking || !speechAvailable()}
                    onClick={() => void hear(trial.pair.a, trial.pair.b)}
                  >
                    Hear both
                  </Button>
                  <Button variant="ghost" onClick={again}>
                    Another one
                  </Button>
                  <Button variant="sound" onClick={nextStep} disabled={isLast}>
                    {isLast ? 'Finished' : 'Next step'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Anything spoken ─────────────────────────────────── */}
        {task && !['listen', 'discriminate'].includes(step) && (
          <div>
            <p className="label-mono text-ink-faint">Say this</p>
            <p className="sound-text mt-2 font-mono text-5xl font-semibold leading-none tracking-tight sm:text-6xl">
              {task.text}
            </p>
            {!task.measured && (
              <p className="label-mono mt-3 text-ink-faint">
                Practice step — nothing is measured
              </p>
            )}

            {phase === 'review' && clip ? (
              <div className="mt-6">
                <RecordingReview
                  clip={clip}
                  busy={false}
                  onUse={() => void submit()}
                  onDiscard={() => {
                    setClip(null)
                    setError(null)
                    setPhase('prompt')
                  }}
                />
              </div>
            ) : phase === 'answered' ? null : (
              <div className="mt-8 flex flex-col items-center gap-4">
                <RecordButton
                  status={recordStatus}
                  level={capturing ? level : 0}
                  elapsedMs={elapsed}
                  maxMs={MAX_CLIP_MS}
                  onStart={() => void start()}
                  onStop={() => {
                    setCapturing(false)
                    void stop()
                  }}
                />
                <Button variant="ghost" onClick={nextStep}>
                  Skip this one
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Result ───────────────────────────────────────────── */}
      {measured && phase === 'answered' && task && (
        <section className="panel animate-rise mt-6 p-5 sm:p-6">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <dt className="label-mono text-ink-faint">Target</dt>
              <dd className="sound-text mt-1 font-mono text-2xl font-bold">
                {task.side.label}
              </dd>
            </div>
            <div>
              <dt className="label-mono text-ink-faint">Estimated pattern</dt>
              <dd className="mt-1 font-mono text-2xl font-bold text-ink">
                {measured.assessed && measured.detected
                  ? measured.detected.toUpperCase()
                  : '—'}
              </dd>
            </div>
            <div>
              <dt className="label-mono text-ink-faint">Practice similarity</dt>
              <dd className="mt-1 text-2xl font-bold tabular-nums text-ink">
                {measured.assessed ? `${Math.round(measured.similarity * 100)}%` : '—'}
              </dd>
            </div>
            <div>
              <dt className="label-mono text-ink-faint">Confidence</dt>
              <dd className="mt-1 text-2xl font-bold tabular-nums text-ink">
                {measured.assessed ? `${Math.round(measured.confidence * 100)}%` : '—'}
              </dd>
            </div>
          </dl>
        </section>
      )}

      {/* ── What the lab says ────────────────────────────────── */}
      {message && phase === 'answered' && (
        <div
          className={`animate-rise mt-6 rounded-2xl p-5 sm:p-6 ${
            message.tone === 'good' ? 'bg-good/10' : 'bg-paper-2'
          }`}
        >
          <p className="text-xl font-semibold text-ink">{message.headline}</p>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">{message.detail}</p>

          {!['listen', 'discriminate'].includes(step) && (
            <div className="mt-5 flex flex-wrap gap-3">
              <Button variant="outline" onClick={again}>
                Try it again
              </Button>
              {!isLast && (
                <Button variant="sound" onClick={nextStep}>
                  Next step
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mt-10 flex flex-wrap gap-3 border-t border-line pt-6">
        <Button variant="ghost" onClick={onLeave}>
          Choose another pair
        </Button>
      </div>

      <p className="mt-6 text-sm leading-relaxed text-ink-faint">
        Sound contrast practice. These results describe the answers and
        recordings you just gave, not your speech in general. PhonoPlay provides
        educational pronunciation feedback and is not a medical diagnosis.
      </p>
    </main>
  )
}
