import type { CSSProperties } from 'react'
import type { Exercise } from '../types/api'
import { SOUND_PROFILES } from '../data/sounds'
import { Button } from './Button'
import { FixtureBadge } from './FixtureBadge'

interface ExercisePanelProps {
  status: 'idle' | 'loading' | 'ready' | 'error'
  exercise: Exercise | null
  onRetryGenerate: () => void
  /** `promptId` is null when the word is not in the prompt bank. */
  onTryAgain: (promptId: string | null) => void
}

function Shimmer({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`relative block overflow-hidden rounded-full bg-paper-2 ${className}`}
    >
      <span className="absolute inset-y-0 w-1/3 animate-sweep bg-linear-to-r from-transparent via-paper to-transparent" />
    </span>
  )
}

export function ExercisePanel({
  status,
  exercise,
  onRetryGenerate,
  onTryAgain,
}: ExercisePanelProps) {
  if (status === 'loading' || status === 'idle') {
    return (
      <section className="panel p-6 sm:p-8" aria-busy="true">
        <h2 className="label-mono text-ink-faint">Your next challenge</h2>
        <p className="mt-4 text-lg font-medium text-ink-soft">
          Building a practice activity for this sound…
        </p>
        <div className="mt-6 space-y-3">
          <Shimmer className="h-6 w-2/3" />
          <Shimmer className="h-6 w-1/2" />
          <Shimmer className="h-16 w-full rounded-2xl" />
        </div>
      </section>
    )
  }

  if (status === 'error' || !exercise) {
    return (
      <section className="panel p-6 sm:p-8">
        <h2 className="label-mono text-ink-faint">Your next challenge</h2>
        <p className="mt-3 text-[0.95rem] leading-relaxed text-ink-soft">
          The challenge generator is unavailable right now. Your score still stands —
          practise the same word again, or pick a new one.
        </p>
        <Button className="mt-5" size="sm" onClick={onRetryGenerate}>
          Try building it again
        </Button>
      </section>
    )
  }

  const profile = SOUND_PROFILES[exercise.target_sound]
  const isPairs = exercise.activity_type === 'minimal_pairs'

  return (
    <section
      style={{ '--sound': profile.color } as CSSProperties}
      className="panel animate-rise overflow-hidden p-0"
    >
      <div className="sound-tint px-6 pb-5 pt-6 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="label-mono text-ink-faint">Your next challenge</h2>
          {exercise._fixture ? (
            <FixtureBadge />
          ) : (
            <span className="label-mono text-ink-faint">
              {exercise.source === 'llm' ? 'AI generated' : 'Practice bank'}
            </span>
          )}
        </div>
        <h3 className="mt-2 text-2xl font-bold text-ink sm:text-3xl">{exercise.title}</h3>
        <p className="mt-3 max-w-prose text-[0.95rem] leading-relaxed text-ink-soft">
          {exercise.cue}
        </p>
      </div>

      <div className="px-6 py-6 sm:px-8">
        <h4 className="label-mono text-ink-faint">
          {isPairs ? 'Say each pair — feel the difference' : 'Practise these'}
        </h4>

        <ul className="mt-4 space-y-2.5">
          {exercise.items.map((item) => (
            <li
              key={item.text}
              className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-paper px-4 py-3"
            >
              <span className="sound-text text-xl font-bold">{item.text}</span>
              {item.contrast && (
                <>
                  <span aria-hidden="true" className="text-ink-faint">
                    vs
                  </span>
                  <span className="text-xl font-semibold text-ink-faint">
                    {item.contrast}
                  </span>
                </>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => onTryAgain(item.prompt_id)}
              >
                Practise “{item.text}”
              </Button>
            </li>
          ))}
        </ul>

        <div className="mt-7 flex flex-wrap gap-3">
          <Button
            variant="sound"
            size="lg"
            onClick={() => onTryAgain(exercise.items[0]?.prompt_id ?? null)}
          >
            Try Again
          </Button>
        </div>
      </div>
    </section>
  )
}
