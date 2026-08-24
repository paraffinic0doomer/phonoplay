import { useEffect, type CSSProperties } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { SOUND_PROFILES } from '../data/sounds'
import { useSession } from '../state/session'
import { ScoreDial } from '../components/ScoreDial'
import { Disclaimer, HowItWorks } from '../components/HowItWorks'
import { SoundCompare } from '../components/SoundCompare'
import { TranscriptionPanel } from '../components/TranscriptionPanel'
import { DeviationCard } from '../components/DeviationCard'
import { PhonemeTimeline } from '../components/PhonemeTimeline'
import { ExercisePanel } from '../components/ExercisePanel'
import { ImprovementGraph } from '../components/ImprovementGraph'
import { FixtureNotice } from '../components/FixtureBadge'
import { Stepper } from '../components/Stepper'
import { Button, ButtonLink } from '../components/Button'

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl bg-paper-2 px-4 py-3">
      <span className="label-mono block text-ink-faint">{label}</span>
      <span className="mt-1 block text-lg font-semibold text-ink">{value}</span>
      {hint && <span className="mt-0.5 block text-xs text-ink-faint">{hint}</span>}
    </div>
  )
}

export function Results() {
  const navigate = useNavigate()
  const {
    state,
    latestAttempt,
    requestExercise,
    attemptsForSound,
    loadPrompt,
  } = useSession()

  const attempt = latestAttempt

  /* Ask for the personalized challenge as soon as a result is on screen. */
  useEffect(() => {
    if (attempt && state.exerciseStatus === 'idle') void requestExercise()
  }, [attempt, state.exerciseStatus, requestExercise])

  if (!attempt) return <Navigate to="/sounds" replace />

  const { result } = attempt
  const sound = result.prompt.target_sound
  const profile = SOUND_PROFILES[sound]
  const history = attemptsForSound(sound)
  const attemptNumber = history.findIndex((entry) => entry.id === attempt.id) + 1

  const graphPoints = history.map((entry, index) => ({
    attempt: index + 1,
    score: Math.round(entry.result.scores.overall),
    word: entry.promptText,
  }))

  const practise = (promptId: string | null) => {
    const query = promptId ? `?prompt=${encodeURIComponent(promptId)}` : ''
    if (!promptId) void loadPrompt(sound, { fresh: true })
    navigate(`/practice/${sound}${query}`)
  }

  return (
    <div
      style={{ '--sound': profile.color } as CSSProperties}
      className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Stepper current="Analyse" />
        <ButtonLink to={`/practice/${sound}`} variant="ghost" size="sm">
          Back to practice
        </ButtonLink>
      </div>

      <header className="mt-6">
        <span className="label-mono text-ink-faint">
          Attempt {attemptNumber || history.length} · {profile.display}
        </span>
        <h1 className="mt-2 text-4xl font-bold tracking-tight text-ink sm:text-5xl">
          “{result.prompt.text}”
        </h1>
      </header>

      {result._fixture && (
        <div className="mt-6">
          <FixtureNotice />
        </div>
      )}

      {/* Score + the numbers behind it */}
      <section className="panel mt-6 flex flex-col items-center gap-8 p-6 sm:p-8 lg:flex-row lg:items-start">
        <ScoreDial
          value={result.scores.overall}
          label="similarity"
          sublabel={`to ${profile.display}`}
        />

        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold text-ink">
            {result.scores.overall >= 85
              ? 'That one landed.'
              : result.scores.overall >= 70
                ? 'Close — the target sound needs a little work.'
                : 'The target sound came out differently.'}
          </h2>
          <p className="mt-2 text-[0.95rem] leading-relaxed text-ink-soft">
            {result.deviation.explanation}
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Stat
              label="Target sound"
              value={`${Math.round(result.scores.target_sound)}%`}
              hint="how close that one sound was"
            />
            {/* Word accuracy is a transcription measure, and the attempt
                endpoint does not transcribe — it returns null. Rendering
                Math.round(null) as "0%" would show a measurement that was
                never taken, and a zero reads as a failed one. */}
            <Stat
              label="Whole word"
              value={
                result.scores.word_accuracy === null
                  ? '—'
                  : `${Math.round(result.scores.word_accuracy)}%`
              }
              hint={
                result.scores.word_accuracy === null
                  ? 'not measured here — see stage 1'
                  : `heard “${result.transcript.text}”`
              }
            />
            <Stat
              label="Recording"
              value={`${result.audio_quality.duration_s.toFixed(2)}s`}
              hint={`${Math.round(result.audio_quality.snr_db)} dB signal`}
            />
          </div>

          {/* Beside the number itself. A footer disclaimer is read once; this
              is the moment a percentage about a child's speech is on screen. */}
          <Disclaimer className="mt-5 border-t border-line pt-4" />
        </div>
      </section>

      {/* Stage 1 — real speech-to-text, shown on its own. */}
      {attempt.transcription && (
        <div className="mt-6">
          <TranscriptionPanel
            transcription={attempt.transcription}
            expected={result.prompt.text}
          />
        </div>
      )}

      {/* Stage 2 — acoustic pronunciation analysis. */}
      <h2 className="label-mono mt-8 text-ink-faint">
        Stage 2 · Pronunciation analysis
      </h2>

      <div className="mt-3 grid gap-6 lg:grid-cols-2">
        <SoundCompare
          result={result}
          waveform={attempt.waveform}
          audio={attempt.audio}
        />
        <DeviationCard result={result} />
      </div>

      <div className="mt-6">
        <PhonemeTimeline result={result} />
      </div>

      {/* Personalized challenge */}
      <div className="mt-6">
        <ExercisePanel
          status={state.exerciseStatus}
          exercise={state.exercise}
          onRetryGenerate={() => void requestExercise()}
          onTryAgain={practise}
        />
      </div>

      {/* Progress so far on this sound */}
      {graphPoints.length > 1 && (
        <section className="panel mt-6 p-6 sm:p-7">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="label-mono text-ink-faint">
              Your {profile.display} attempts
            </h2>
            <ButtonLink to="/progress" variant="ghost" size="sm">
              Full progress
            </ButtonLink>
          </div>
          <div className="mt-4">
            <ImprovementGraph points={graphPoints} />
          </div>
        </section>
      )}

      <div className="mt-8 flex flex-wrap gap-3">
        <Button variant="sound" size="lg" onClick={() => practise(result.prompt.id)}>
          Say “{result.prompt.text}” again
        </Button>
        <Button variant="outline" size="lg" onClick={() => practise(null)}>
          New word
        </Button>
      </div>

      <div className="mt-10">
        <HowItWorks compact />
      </div>
    </div>
  )
}
