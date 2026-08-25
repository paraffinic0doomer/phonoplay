import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'

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
import { SOUND_PROFILES, isSoundId } from '../data/sounds'
import { StageLadder } from '../components/StageLadder'
import { AttemptResultPanel } from '../components/AttemptResultPanel'
import {
  PHONEME_LABEL,
  PHONEME_NAME,
  STAGE_LABEL,
  STAGE_PURPOSE,
  itemFor,
} from '../practice/material'
import { feedbackFor, missionLine, readyToAdvance, supportOffer } from '../practice/feedback'
import type { AttemptFeedback } from '../practice/feedback'
import { speak, speechAvailable, stopSpeaking } from '../assessment/speech'
import {
  advanceIfReady,
  evaluate,
  ladderIndex,
  recordPracticeAttempt,
  setStage,
} from '../db'
import type { LearnerPolicy, Phoneme, PhonemeProfile, SkillType, StageVerdict } from '../db'

/**
 * The practice engine.
 *
 * One loop, in the order the product describes it:
 *
 *   mission -> learn -> listen -> record -> analyse -> feedback
 *      ^                                                  |
 *      +------------- continue <- update <- retry --------+
 *
 * Two things about it are load-bearing rather than cosmetic.
 *
 * **The learner model decides when to move on, not this screen.** The rung
 * comes from `evaluate()`, which reads the profile and the mode's policy.
 * This component asks; it never awards. Standard Mode climbs
 * sound -> word -> phrase -> sentence, Accessibility Mode
 * sound -> syllable -> minimal pair -> word -> phrase -> sentence, and the
 * order is the policy's, not this file's.
 *
 * **Nothing here can take anything away.** There is no path that lowers a
 * stage, clears a history, or reports a failure. A poor attempt is recorded,
 * shown, and followed by another go.
 */

type Phase = 'learn' | 'record' | 'review' | 'analysing' | 'feedback'

interface Attempt {
  index: number
  similarity: number | null
  confidence: number | null
  assessed: boolean
  detected: string | null
  feedback: AttemptFeedback
}

export function PracticeEngine() {
  const { sound } = useParams()
  const navigate = useNavigate()
  const valid = isSoundId(sound)
  const phoneme = (valid ? sound : 's') as Phoneme

  const [profile, setProfile] = useState<PhonemeProfile | null>(null)
  const [policy, setPolicy] = useState<LearnerPolicy | null>(null)
  const [verdict, setVerdict] = useState<StageVerdict | null>(null)
  const [phase, setPhase] = useState<Phase>('learn')
  const [clip, setClip] = useState<RecordingClip | null>(null)
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [error, setError] = useState<{ code: string; message: string; retryable: boolean } | null>(
    null,
  )
  const [capturing, setCapturing] = useState(false)
  const [level, setLevel] = useState(0)
  const [speaking, setSpeaking] = useState(false)
  const [sessionId] = useState(() =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `practice-${Date.now()}`,
  )

  // A ref, not state: it is read inside async callbacks to decide whether to
  // touch React at all, and it must never itself cause a render.
  const alive = useRef(true)

  const elapsed = useElapsed(capturing)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      stopSpeaking()
    }
  }, [])

  /** Read the learner model. The single source for which rung we are on. */
  const refresh = useCallback(async () => {
    const state = await evaluate(phoneme)
    if (!alive.current) return
    setProfile(state.profile)
    setPolicy(state.policy)
    setVerdict(state.stage)
  }, [phoneme])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /*
   * Where the learner is *now* — which is not what the verdict reports.
   *
   * `assessStage` answers "which rung should they be on", so once they are
   * ready it returns the *next* one. Reading that as the current rung meant
   * the mission heading, the ladder and the practice item all jumped forward
   * the moment the model said yes, before the learner pressed anything. That
   * silently advanced them and contradicted the whole point of asking.
   *
   * The profile is the source of where they are; the verdict is the source of
   * where they may go.
   */
  const stage: SkillType = useMemo(() => {
    if (!profile || !policy) return 'sound'
    return policy.stages[ladderIndex(profile.currentStage, policy.stages)]
  }, [profile, policy])
  const item = useMemo(
    () => itemFor(phoneme, stage, attempts.length),
    [phoneme, stage, attempts.length],
  )

  const { recorderRef, start, stop, support } = useCapture({
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

  /* Live input level for the button ring. */
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

  /* The same eight-second ceiling as everywhere else. */
  useEffect(() => {
    if (!capturing) return
    const id = window.setTimeout(() => void stop(), MAX_CLIP_MS)
    return () => window.clearTimeout(id)
  }, [capturing, stop])

  const hear = useCallback(async (text: string) => {
    setSpeaking(true)
    await speak(text)
    setSpeaking(false)
  }, [])

  /**
   * Analyse -> feedback -> update, in that order.
   *
   * The measurement is written to the learner model before the screen shows
   * anything, so a learner who closes the tab at the wrong moment keeps the
   * attempt they just made.
   */
  const analyse = useCallback(async () => {
    if (!clip) return
    setPhase('analysing')
    setError(null)
    try {
      const result = await measurePronunciation({
        clip,
        targetSound: phoneme,
        expectedText: item.text,
        sessionId,
      })
      if (!alive.current) return

      const similarity = result.assessed ? result.similarity_score : null
      const confidence = result.assessed ? result.confidence : null

      // Straight into the local model: session, attempt, and the profile fold.
      await recordPracticeAttempt({
        phoneme,
        prompt: item.text,
        // This engine never transcribes: the acoustic stage is the only thing
        // measuring here, and a transcript would be a second signal nobody
        // asked for. Null rather than an empty string, which would read as
        // "heard nothing" instead of "did not listen".
        transcript: null,
        similarityScore: similarity,
        confidence,
        estimatedPhoneme: result.estimated_match,
        feedbackCode: result.feedback_code,
        assessed: result.assessed,
        duration: clip.durationS,
      })

      const previous = attempts.filter((a) => a.similarity !== null).at(-1)?.similarity ?? null
      const entry: Attempt = {
        index: attempts.length + 1,
        similarity,
        confidence,
        assessed: result.assessed,
        detected: result.estimated_match,
        feedback: feedbackFor({
          phoneme,
          similarity,
          assessed: result.assessed,
          detected: result.estimated_match,
          previous,
        }),
      }
      setAttempts((current) => [...current, entry])
      await refresh()
      if (alive.current) setPhase('feedback')
    } catch (cause) {
      if (!alive.current) return
      setError({
        code:
          cause && typeof cause === 'object' && 'code' in cause
            ? String((cause as { code: unknown }).code)
            : 'UNKNOWN',
        message:
          cause instanceof Error ? cause.message : 'Could not measure that recording.',
        retryable: true,
      })
      setPhase('review')
    }
  }, [clip, phoneme, item.text, sessionId, attempts, refresh])

  /** Another go at the same rung. Nothing is cleared. */
  const retry = useCallback(() => {
    setClip(null)
    setError(null)
    setPhase('record')
  }, [])

  /** The learner accepts the invitation to move up. Never automatic. */
  const advance = useCallback(async () => {
    const moved = await advanceIfReady(phoneme)
    if (!alive.current) return
    if (moved.advanced) {
      setAttempts([])
      setClip(null)
      setPhase('learn')
    }
    await refresh()
  }, [phoneme, refresh])

  /**
   * Step down to a shorter form, only ever by the learner's own choice.
   *
   * Offered when someone has been on one rung a long time. This is the only
   * place a stage moves down, it requires a deliberate press, and it is
   * framed as trying something shorter rather than as being sent back.
   */
  const stepDown = useCallback(async () => {
    if (!policy) return
    const index = policy.stages.indexOf(stage)
    if (index <= 0) return
    await setStage(phoneme, policy.stages[index - 1])
    if (!alive.current) return
    setAttempts([])
    setPhase('learn')
    await refresh()
  }, [policy, stage, phoneme, refresh])

  if (!valid) return <Navigate to="/sounds" replace />
  if (!profile || !policy || !verdict) {
    return (
      <main className="mx-auto max-w-2xl px-5 py-16">
        <p className="label-mono text-ink-faint" aria-live="polite">
          Opening your practice…
        </p>
      </main>
    )
  }

  const soundProfile = SOUND_PROFILES[phoneme]
  const latest = attempts.at(-1) ?? null
  // Only ever the rung immediately above, and only when the model allows it.
  const nextStage = verdict.advance ? verdict.stage : undefined
  const canAdvance = Boolean(nextStage) && nextStage !== stage

  const recordStatus: RecordStatus =
    support !== 'ok'
      ? 'blocked'
      : phase === 'analysing'
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
      {/* ── Today's mission ──────────────────────────────────── */}
      <header>
        <p className="label-mono text-ink-faint">Today’s mission</p>
        <h1 className="mt-2 flex flex-wrap items-baseline gap-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
          <span className="sound-text font-mono">{PHONEME_LABEL[phoneme]}</span>
          <span className="text-xl font-semibold text-ink-soft sm:text-2xl">
            {STAGE_LABEL[stage].toLowerCase()} level
          </span>
        </h1>
        <p className="sr-only">{missionLine(phoneme, STAGE_LABEL[stage])}</p>
      </header>

      <div className="mt-6">
        <StageLadder stages={policy.stages} current={stage} />
      </div>

      {/* ── Learn ────────────────────────────────────────────── */}
      <section className="panel mt-6 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="label-mono text-ink-faint">{STAGE_LABEL[stage]}</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-soft">
              {STAGE_PURPOSE[stage]}
            </p>
          </div>
          <span className="sound-text w-16 shrink-0">
            <MouthDiagram sound={phoneme} />
          </span>
        </div>

        <p className="sound-text mt-6 font-mono text-5xl font-semibold leading-none tracking-tight sm:text-6xl">
          {item.text}
        </p>
        {item.contrast && (
          <p className="mt-2 text-lg text-ink-faint">
            not <span className="font-mono font-semibold">{item.contrast}</span>
          </p>
        )}
        <p className="mt-4 text-base leading-relaxed text-ink-soft">{item.instruction}</p>
        {item.vehicle && (
          <p className="label-mono mt-3 text-ink-faint">
            {PHONEME_NAME[phoneme]} needs a vowel after it to be measured
          </p>
        )}

        {/* ── Listen ─────────────────────────────────────────── */}
        <div className="mt-5 flex flex-wrap gap-3">
          <Button
            variant="outline"
            disabled={speaking || !speechAvailable()}
            onClick={() => void hear(item.text)}
          >
            {speaking ? 'Playing…' : 'Hear it'}
          </Button>
          {item.contrast && (
            <Button
              variant="ghost"
              disabled={speaking || !speechAvailable()}
              onClick={() => void hear(item.contrast as string)}
            >
              Hear “{item.contrast}”
            </Button>
          )}
        </div>
      </section>

      {error && (
        <div className="mt-6">
          <ErrorNotice
            error={error}
            onDismiss={() => setError(null)}
            onRetry={clip ? () => void analyse() : undefined}
            retryLabel="Send again"
          />
          <div className="mt-3">
            <Button variant="ghost" onClick={retry}>
              Record it again
            </Button>
          </div>
        </div>
      )}

      {/* ── Record / Analyse ─────────────────────────────────── */}
      {phase === 'review' && clip ? (
        <div className="mt-6">
          <RecordingReview
            clip={clip}
            busy={false}
            onUse={() => void analyse()}
            onDiscard={retry}
          />
        </div>
      ) : (
        phase !== 'feedback' && (
          <div className="mt-8 flex flex-col items-center">
            <RecordButton
              status={recordStatus}
              level={capturing ? level : 0}
              elapsedMs={elapsed}
              maxMs={MAX_CLIP_MS}
              onStart={() => void start()}
              onStop={() => void stop()}
            />
          </div>
        )
      )}

      {/* ── Feedback ─────────────────────────────────────────── */}
      {phase === 'feedback' && latest && (
        <div className="mt-6">
          <AttemptResultPanel
            phoneme={phoneme}
            attempt={latest}
            attempts={attempts}
            onRetry={retry}
          />

          {/* ── Continue ─────────────────────────────────────── */}
          <div className="mt-6 space-y-3">
            {canAdvance && nextStage && (
              <div className="sound-tint animate-rise rounded-2xl p-5">
                <p className="text-lg font-semibold text-ink">
                  {readyToAdvance(STAGE_LABEL[nextStage]).headline}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                  {readyToAdvance(STAGE_LABEL[nextStage]).detail}
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Button variant="sound" onClick={() => void advance()}>
                    Move to {STAGE_LABEL[nextStage].toLowerCase()}
                  </Button>
                  <Button variant="ghost" onClick={retry}>
                    Stay here a bit longer
                  </Button>
                </div>
              </div>
            )}

            {!canAdvance && verdict.needsSupport && (
              <div className="rounded-2xl bg-paper-2 p-5">
                <p className="text-lg font-semibold text-ink">{supportOffer().headline}</p>
                <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                  {supportOffer().detail}
                </p>
                {policy.stages.indexOf(stage) > 0 && (
                  <div className="mt-4">
                    <Button variant="outline" onClick={() => void stepDown()}>
                      Try the shorter form
                    </Button>
                  </div>
                )}
              </div>
            )}

            {!canAdvance && !verdict.needsSupport && (
              <Button variant="sound" size="lg" onClick={retry}>
                Go again
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
        <ButtonLink to="/sounds" variant="ghost" size="sm">
          Change sound
        </ButtonLink>
        <button
          type="button"
          onClick={() => navigate('/progress')}
          className="label-mono text-ink-faint underline underline-offset-2 hover:text-ink"
        >
          See progress
        </button>
      </div>
    </main>
  )
}
