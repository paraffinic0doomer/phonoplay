import { useState, type CSSProperties } from 'react'
import { SOUND_LIST, SOUND_PROFILES, ipaToDisplay } from '../data/sounds'
import type { SoundId } from '../types/api'
import { useSession, type AttemptRecord } from '../state/session'
import { ImprovementGraph } from '../components/ImprovementGraph'
import { Button, ButtonLink } from '../components/Button'
import { Stepper } from '../components/Stepper'
import { WaveField } from '../components/WaveField'
import { FixtureBadge } from '../components/FixtureBadge'
import { learnerState } from '../lib/learnerState'

function AttemptRow({ attempt, index }: { attempt: AttemptRecord; index: number }) {
  const score = Math.round(attempt.result.scores.overall)
  const heard = attempt.result.target_analysis.occurrences[0]?.observed_top[0]?.phoneme
  const target = attempt.result.target_analysis.target_phoneme
  const onTarget = heard === target

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line py-3 last:border-b-0">
      <span className="label-mono w-20 shrink-0 text-ink-faint">
        Attempt {index + 1}
      </span>
      <span className="min-w-0 flex-1 truncate font-semibold text-ink">
        “{attempt.promptText}”
      </span>
      <span className="label-mono text-ink-faint">
        {onTarget ? 'on target' : `heard ${ipaToDisplay(heard ?? null)}`}
      </span>
      <span className="flex items-center gap-3">
        <span className="h-2 w-20 overflow-hidden rounded-full bg-paper-2 sm:w-28">
          <span className="sound-bg block h-full rounded-full" style={{ width: `${score}%` }} />
        </span>
        <span className="w-12 text-right text-lg font-bold tabular-nums text-ink">
          {score}%
        </span>
      </span>
    </li>
  )
}

function SoundSection({ sound, attempts }: { sound: SoundId; attempts: AttemptRecord[] }) {
  const profile = SOUND_PROFILES[sound]
  const state = learnerState(sound, attempts.map((attempt) => attempt.result))
  const points = attempts.map((attempt, index) => ({
    attempt: index + 1,
    score: Math.round(attempt.result.scores.overall),
    word: attempt.promptText,
  }))
  const best = Math.max(...points.map((point) => point.score))

  return (
    <section
      style={{ '--sound': profile.color } as CSSProperties}
      className="panel overflow-hidden p-0"
    >
      <div className="sound-tint flex flex-wrap items-center justify-between gap-3 px-6 py-5">
        <div className="flex items-baseline gap-3">
          <span className="sound-text font-mono text-3xl font-semibold">
            {profile.display}
          </span>
          <span className="label-mono text-ink-faint">
            {attempts.length} attempt{attempts.length === 1 ? '' : 's'} · best {best}%
          </span>
        </div>
        <ButtonLink to={`/practice/${sound}`} variant="sound" size="sm">
          Practise {profile.display}
        </ButtonLink>
      </div>

      <div className="px-6 py-6">
        <div className="mb-5 grid gap-3 text-sm sm:grid-cols-4">
          <div><span className="label-mono block text-ink-faint">Mastery</span><strong className="text-ink">{Math.round(state.mastery)}%</strong></div>
          <div><span className="label-mono block text-ink-faint">Confidence</span><strong className="text-ink">{Math.round(state.confidence * 100)}%</strong></div>
          <div><span className="label-mono block text-ink-faint">Recent trend</span><strong className="capitalize text-ink">{state.trend}</strong></div>
          <div><span className="label-mono block text-ink-faint">Next practice</span><strong className="text-ink">{state.recommended_difficulty.replaceAll('_', ' ')}</strong></div>
        </div>
        <ImprovementGraph points={points} />

        <ol className="mt-6 border-t border-line pt-2">
          {attempts.map((attempt, index) => (
            <AttemptRow key={attempt.id} attempt={attempt} index={index} />
          ))}
        </ol>
      </div>
    </section>
  )
}

export function Progress() {
  const { state, resetSession } = useSession()
  const [confirmReset, setConfirmReset] = useState(false)

  const practised = SOUND_LIST.map((profile) => ({
    sound: profile.id,
    attempts: state.attempts.filter((attempt) => attempt.targetSound === profile.id),
  })).filter((entry) => entry.attempts.length > 0)

  const usedFixtures = state.attempts.some((attempt) => attempt.result._fixture)

  if (state.attempts.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
        <div className="text-ink-faint">
          <WaveField ambient amplitude={0.3} lines={3} height={80} />
        </div>
        <h1 className="mt-6 text-4xl font-bold tracking-tight text-ink">
          No attempts yet
        </h1>
        <p className="mx-auto mt-4 max-w-md text-lg leading-relaxed text-ink-soft">
          Record one word and your score will show up here. Every attempt in this session
          is kept so you can watch the same sound improve.
        </p>
        <div className="mt-8 flex justify-center">
          <ButtonLink to="/sounds" size="lg">
            Start a Sound Lab
          </ButtonLink>
        </div>
      </div>
    )
  }

  const allScores = state.attempts.map((attempt) => attempt.result.scores.overall)
  const best = Math.round(Math.max(...allScores))

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <div style={{ '--sound': 'var(--color-ink)' } as CSSProperties}>
        <Stepper current="Practise" />
      </div>

      <header className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-ink sm:text-5xl">
            Your progress
          </h1>
          <p className="mt-3 text-lg text-ink-soft">
            {state.attempts.length} attempt{state.attempts.length === 1 ? '' : 's'} across{' '}
            {practised.length} sound{practised.length === 1 ? '' : 's'} · best {best}%
          </p>
        </div>
        {usedFixtures && <FixtureBadge />}
      </header>

      <div className="mt-8 space-y-6">
        {practised.map((entry) => (
          <SoundSection key={entry.sound} sound={entry.sound} attempts={entry.attempts} />
        ))}
      </div>

      <div className="mt-10 flex flex-wrap items-center gap-3 border-t border-line pt-6">
        <ButtonLink to="/sounds" variant="outline">
          Practise another sound
        </ButtonLink>

        {confirmReset ? (
          <>
            <span className="text-sm text-ink-soft">Clear all attempts?</span>
            <Button
              size="sm"
              onClick={() => {
                resetSession()
                setConfirmReset(false)
              }}
            >
              Yes, clear
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmReset(false)}>
              Keep them
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setConfirmReset(true)}>
            Start a fresh session
          </Button>
        )}
      </div>
    </div>
  )
}
