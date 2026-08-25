import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'

import { MAX_CLIP_MS } from '../lib/recorder'
import type { RecordingClip } from '../lib/recorder'
import { measurePronunciation } from '../lib/api'
import { useCapture } from '../state/useCapture'
import { RecordButton, useElapsed } from '../components/RecordButton'
import type { RecordStatus } from '../components/RecordButton'
import { RecordingReview } from '../components/RecordingReview'
import { ErrorNotice } from '../components/ErrorNotice'
import { Button } from '../components/Button'
import { MouthDiagram } from '../components/MouthDiagram'
import { SOUND_PROFILES } from '../data/sounds'
import type { SoundId } from '../types/api'
import { PHONEME_NAME, measuredCount, planFor } from '../assessment/plan'
import type { Task } from '../assessment/plan'
import { buildProfile } from '../assessment/profile'
import type { AssessmentMeasurement } from '../assessment/profile'
import { speak, speakPair, speechAvailable, stopSpeaking } from '../assessment/speech'
import { ProfileCard } from '../components/ProfileCard'
import { getLearningMode, recordContrastAttempt, recordMeasurement } from '../db'
import type { LearningMode } from '../db'

/**
 * The baseline assessment.
 *
 * One task on screen at a time, in both modes. Every percentage the profile
 * at the end reports comes from `POST /api/pronunciation` measuring the
 * learner's own recording — there is no path through this screen that invents
 * one. A task the analyser declines to score is recorded as declined and left
 * out of the average rather than being counted as a low score.
 *
 * Audio never leaves memory: each clip is uploaded, measured, and dropped as
 * the next task begins.
 */

type Phase = 'task' | 'review' | 'measuring' | 'done'

export function Assessment() {
  const navigate = useNavigate()

  const [mode, setMode] = useState<LearningMode | null>(null)
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState<Phase>('task')
  const [clip, setClip] = useState<RecordingClip | null>(null)
  const [error, setError] = useState<{ code: string; message: string; retryable: boolean } | null>(
    null,
  )
  const [measurements, setMeasurements] = useState<AssessmentMeasurement[]>([])
  const [speaking, setSpeaking] = useState(false)
  const [pairAnswer, setPairAnswer] = useState<'correct' | 'wrong' | null>(null)
  const [level, setLevel] = useState(0)

  // A lazy useState initializer is the sanctioned place to generate this:
  // it runs exactly once, and unlike a bare call during render it is not a
  // side effect in the render path.
  const [sessionId] = useState(() =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `assess-${Date.now()}`,
  )
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      stopSpeaking()
    }
  }, [])

  useEffect(() => {
    void getLearningMode().then((value) => {
      if (alive.current) setMode(value)
    })
  }, [])

  const plan = useMemo<Task[]>(() => (mode ? planFor(mode) : []), [mode])
  const task = plan[index]
  const total = plan.length
  const measuredTotal = useMemo(() => measuredCount(plan), [plan])

  const recording = phase === 'task'
  const { recorderRef, start, stop, support } = useCapture({
    // Set here, not on the click: the button must not show "stop" until the
    // device is actually open. Flipping it optimistically meant a permission
    // prompt or a failed start left a stop button that stopped nothing, and
    // the task could not be completed or escaped.
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

  const [capturing, setCapturing] = useState(false)
  const elapsed = useElapsed(capturing)

  /* Live input level, for the button ring. */
  useEffect(() => {
    // No reset here: the value is read back through `capturing ? level : 0`
    // below, so stopping needs no extra state write and no extra render.
    if (!capturing) return
    let frame = 0
    const tick = () => {
      setLevel(recorderRef.current?.level() ?? 0)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [capturing, recorderRef])

  /* The same eight-second ceiling the rest of the app uses. */
  useEffect(() => {
    if (!capturing) return
    const id = window.setTimeout(() => void stop(), MAX_CLIP_MS)
    return () => window.clearTimeout(id)
  }, [capturing, stop])

  const advance = useCallback(() => {
    stopSpeaking()
    setClip(null)
    setError(null)
    setPairAnswer(null)
    setPhase('task')
    setIndex((current) => current + 1)
  }, [])

  const hear = useCallback(
    async (text: string, pair?: string) => {
      setSpeaking(true)
      await (pair ? speakPair(text, pair) : speak(text))
      if (alive.current) setSpeaking(false)
    },
    [],
  )

  /**
   * Send one recording for measurement.
   *
   * A response always advances, including one where the analyser declined to
   * name a sound - that is a real result and is recorded as unassessed.
   *
   * A failed *request* is different: nothing was measured, so nothing is
   * recorded, and the learner is offered the choice of sending again or
   * moving on. They are never stuck on a task they cannot get past.
   */
  const submit = useCallback(async () => {
    if (!clip || !task) return
    setPhase('measuring')
    setError(null)
    try {
      const result = await measurePronunciation({
        clip,
        targetSound: task.phoneme,
        expectedText: task.text,
        sessionId,
      })
      if (!alive.current) return

      const measurement: AssessmentMeasurement = {
        taskId: task.id,
        phoneme: task.phoneme,
        similarity: result.assessed ? result.similarity_score : null,
        confidence: result.assessed ? result.confidence : null,
        assessed: result.assessed,
      }
      setMeasurements((current) => [...current, measurement])

      // Straight into the learner model, so the profile survives a reload
      // even if the learner closes the tab before the last task.
      await recordMeasurement({
        phoneme: task.phoneme,
        similarity: measurement.similarity,
        confidence: measurement.confidence,
        assessed: measurement.assessed,
      })

      advance()
    } catch (cause) {
      if (!alive.current) return
      const code =
        cause && typeof cause === 'object' && 'code' in cause
          ? String((cause as { code: unknown }).code)
          : 'UNKNOWN'
      // Nothing is recorded here. The request never reached the analyser, so
      // there is no measurement to record - and recording one now would be
      // counted a second time if the learner retries.
      setError({
        code,
        message: cause instanceof Error ? cause.message : 'Could not measure that recording.',
        retryable: true,
      })
      setPhase('review')
    }
  }, [clip, task, advance, sessionId])

  /* Perception task: the answer is real data, so it is stored. */
  const answerPair = useCallback(
    async (choice: string) => {
      if (!task?.contrast) return
      const correct = choice === task.text
      setPairAnswer(correct ? 'correct' : 'wrong')
      // `correct` is derived inside the db layer from response === target,
      // so the stored answer can never disagree with the stored judgement.
      await recordContrastAttempt({
        contrast: `${task.text}/${task.contrast}`,
        target: task.text,
        response: choice,
        phoneme: task.phoneme,
      })
    },
    [task],
  )

  /*
   * Finished: the profile is a pure function of what was measured, so it is
   * derived rather than stored. Nothing can leave a stale profile behind, and
   * there is no render in which the tasks are done but the profile is not.
   */
  const finished = plan.length > 0 && index >= plan.length
  const profile = finished ? buildProfile(measurements) : null

  if (!mode) {
    return (
      <main className="mx-auto max-w-2xl px-5 py-16">
        <p className="label-mono text-ink-faint" aria-live="polite">
          Preparing your assessment…
        </p>
      </main>
    )
  }

  if (profile) {
    return <ProfileCard profile={profile} onContinue={() => navigate('/sounds')} />
  }

  if (!task) return null

  const sound = task.phoneme as SoundId
  const soundProfile = SOUND_PROFILES[sound]
  const measuredSoFar = plan.slice(0, index).filter((item) => item.measured).length

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
      {/* Progress */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <span className="label-mono text-ink-faint">
            Step {index + 1} of {total}
          </span>
          <span className="label-mono text-ink-faint">
            {measuredSoFar}/{measuredTotal} measured
          </span>
        </div>
        <ol className="flex gap-1" aria-label={`Assessment progress: step ${index + 1} of ${total}`}>
          {plan.map((item, position) => (
            <li
              key={item.id}
              aria-current={position === index ? 'step' : undefined}
              className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
                position < index
                  ? 'bg-ink'
                  : position === index
                    ? 'bg-[var(--sound)]'
                    : 'bg-line'
              }`}
            />
          ))}
        </ol>
      </div>

      <div key={task.id} className="animate-rise mt-8">
        <div className="flex items-center justify-between gap-4">
          <span className="label-mono text-ink-faint">
            {PHONEME_NAME[task.phoneme]}
          </span>
          <span className="sound-text w-14 shrink-0">
            <MouthDiagram sound={sound} />
          </span>
        </div>

        {/* What to say, or hear */}
        <p className="sound-text mt-4 font-mono text-5xl font-semibold leading-none tracking-tight sm:text-6xl">
          {task.text}
        </p>
        <p className="mt-4 text-base leading-relaxed text-ink-soft">{task.instruction}</p>

        {!task.measured && (
          <p className="label-mono mt-3 text-ink-faint">
            Practice step — not part of your profile
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
            {/* Always a way forward.
                A refused recording is the right answer often enough - a
                broken microphone, a noisy room, a sound someone cannot make
                today - and without this the assessment could not be finished
                at all. Skipping records nothing, so the sound simply shows no
                percentage rather than a low one. */}
            <div className="mt-3">
              <Button variant="ghost" onClick={advance}>
                Skip this one and carry on
              </Button>
            </div>
          </div>
        )}

        {/* ── Listen ─────────────────────────────────────────── */}
        {task.kind === 'listen' && (
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button
              variant="sound"
              size="lg"
              disabled={speaking || !speechAvailable()}
              onClick={() => void hear(task.text)}
            >
              {speaking ? 'Playing…' : 'Hear it'}
            </Button>
            <Button variant="outline" size="lg" onClick={advance}>
              Continue
            </Button>
            {!speechAvailable() && (
              <p className="w-full text-sm leading-relaxed text-ink-soft">
                This browser has no built-in voice, so there is nothing to play here.
                The mouth diagram above shows where the sound is made — carry on when
                you are ready.
              </p>
            )}
          </div>
        )}

        {/* ── Minimal pair ───────────────────────────────────── */}
        {task.kind === 'minimal-pair' && task.contrast && (
          <div className="mt-8">
            <Button
              variant="outline"
              size="lg"
              disabled={speaking || !speechAvailable()}
              onClick={() => void hear(task.text, task.contrast)}
            >
              {speaking ? 'Playing…' : 'Hear both'}
            </Button>

            <p className="mt-6 text-sm text-ink-soft">
              Which one has {PHONEME_NAME[task.phoneme]}?
            </p>
            <div
              role="radiogroup"
              aria-label={`Which word has ${PHONEME_NAME[task.phoneme]}?`}
              className="mt-3 flex flex-wrap gap-3"
            >
              {[task.text, task.contrast].map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={pairAnswer !== null && option === task.text}
                  disabled={pairAnswer !== null}
                  onClick={() => void answerPair(option)}
                  className={`rounded-2xl border-2 px-6 py-4 text-xl font-semibold transition-colors ${
                    pairAnswer !== null && option === task.text
                      ? 'border-good bg-good/10 text-ink'
                      : 'border-line bg-paper text-ink hover:border-line-strong'
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>

            {pairAnswer && (
              <p className="animate-rise mt-4 text-sm leading-relaxed text-ink-soft">
                {pairAnswer === 'correct'
                  ? `Yes — “${task.text}” is the one with ${PHONEME_NAME[task.phoneme]}.`
                  : `“${task.text}” is the one with ${PHONEME_NAME[task.phoneme]}. Hearing the difference takes practice.`}
              </p>
            )}

            <div className="mt-6">
              <Button variant="sound" size="lg" onClick={advance} disabled={!pairAnswer}>
                Continue
              </Button>
            </div>
          </div>
        )}

        {/* ── Anything spoken ────────────────────────────────── */}
        {(task.kind === 'word' ||
          task.kind === 'phrase' ||
          task.kind === 'sentence' ||
          task.kind === 'repeat-sound') && (
          <div className="mt-8">
            {phase === 'review' && clip ? (
              <RecordingReview
                clip={clip}
                busy={false}
                onUse={() => {
                  if (task.measured) void submit()
                  else advance()
                }}
                onDiscard={() => {
                  setClip(null)
                  setError(null)
                  setPhase('task')
                }}
              />
            ) : (
              <div className="flex flex-col items-center gap-4">
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
                {!task.measured && recording && (
                  <Button variant="ghost" onClick={advance}>
                    Skip this one
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
