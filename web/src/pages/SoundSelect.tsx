import { useEffect, useState, type CSSProperties } from 'react'
import { SOUND_LIST, SOUND_PROFILES } from '../data/sounds'
import type { SoundId, TargetSound } from '../types/api'
import { getSounds } from '../lib/api'
import { useSession, type AppError } from '../state/session'
import { SoundCard } from '../components/SoundCard'
import { Stepper } from '../components/Stepper'
import { ErrorNotice } from '../components/ErrorNotice'
import { MouthDiagram } from '../components/MouthDiagram'

function SoundCardSkeleton() {
  return (
    <div className="panel h-72 animate-pulse p-6" aria-hidden="true">
      <div className="h-12 w-24 rounded-xl bg-paper-2" />
      <div className="mt-6 h-4 w-full rounded-full bg-paper-2" />
      <div className="mt-2 h-4 w-2/3 rounded-full bg-paper-2" />
      <div className="mt-8 h-8 w-full rounded-full bg-paper-2" />
    </div>
  )
}

export function SoundSelect() {
  const { state, selectSound, attemptsForSound } = useSession()
  const [catalogue, setCatalogue] = useState<TargetSound[] | null>(null)
  const [error, setError] = useState<AppError | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setError(null)
    setCatalogue(null)

    getSounds()
      .then((sounds) => {
        if (!cancelled) setCatalogue(sounds)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setError({
          code: 'NETWORK_UNAVAILABLE',
          message: cause instanceof Error ? cause.message : 'Could not load sounds.',
          retryable: true,
        })
      })

    return () => {
      cancelled = true
    }
  }, [reloadKey])

  /** Prefer the backend's copy when it is available. */
  const describe = (id: SoundId) =>
    catalogue?.find((entry) => entry.id === id)?.description ??
    SOUND_PROFILES[id].description

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <div style={{ '--sound': 'var(--color-ink)' } as CSSProperties}>
        <Stepper current="Sound" />
      </div>

      <header className="mt-6 max-w-2xl">
        <h1 className="text-4xl font-bold tracking-tight text-ink sm:text-5xl">
          Which sound are we training?
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-ink-soft">
          Pick one to start. You can switch at any time — your attempts are kept for the
          whole session.
        </p>
      </header>

      {error && (
        <div className="mt-8">
          <ErrorNotice
            error={error}
            onRetry={() => setReloadKey((key) => key + 1)}
            retryLabel="Reload sounds"
          />
        </div>
      )}

      <ul className="mt-9 grid gap-5 sm:grid-cols-2">
        {catalogue === null && !error
          ? SOUND_LIST.map((profile) => (
              <li key={profile.id}>
                <SoundCardSkeleton />
              </li>
            ))
          : SOUND_LIST.map((profile) => (
              <li key={profile.id}>
                <SoundCard
                  profile={{ ...profile, description: describe(profile.id) }}
                  to={`/practice/${profile.id}`}
                  onSelect={() => selectSound(profile.id)}
                  attemptCount={attemptsForSound(profile.id).length}
                />
              </li>
            ))}
      </ul>

      {/* How each sound is made — the reference panel. */}
      <section className="mt-14">
        <h2 className="label-mono text-ink-faint">How each sound is made</h2>
        <ul className="mt-5 grid gap-4 lg:grid-cols-2">
          {SOUND_LIST.map((profile) => (
            <li
              key={profile.id}
              style={{ '--sound': profile.color } as CSSProperties}
              className="panel flex gap-5 p-5"
            >
              <span className="sound-text w-20 shrink-0 self-center">
                <MouthDiagram sound={profile.id} />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="sound-text font-mono text-xl font-semibold">
                    {profile.display}
                  </span>
                  <span className="label-mono text-ink-faint">
                    {profile.difficultyNote}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                  {profile.articulation}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {state.attempts.length > 0 && (
        <p className="mt-10 text-sm text-ink-faint">
          You have made {state.attempts.length} attempt
          {state.attempts.length === 1 ? '' : 's'} this session.
        </p>
      )}
    </div>
  )
}
