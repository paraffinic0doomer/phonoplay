import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import type { SoundProfile } from '../data/sounds'
import { MouthDiagram } from './MouthDiagram'
import { DifficultyDots } from './DifficultyDots'

interface SoundCardProps {
  profile: SoundProfile
  to: string
  onSelect?: () => void
  /** Number of attempts already made on this sound this session. */
  attemptCount?: number
}

/**
 * One target sound on the selection screen. The whole card is a single link,
 * so it is reachable and activatable by keyboard with no extra handling.
 */
export function SoundCard({ profile, to, onSelect, attemptCount = 0 }: SoundCardProps) {
  return (
    <Link
      to={to}
      onClick={onSelect}
      style={{ '--sound': profile.color } as CSSProperties}
      className="panel group relative flex flex-col overflow-hidden p-6 transition-[transform,box-shadow] duration-200 hover:-translate-y-1 hover:shadow-[0_10px_0_-2px_var(--color-line-strong)] sm:p-7"
    >
      {/* Colour bar keeps the sound identifiable without relying on hue alone */}
      <span aria-hidden="true" className="sound-bg absolute inset-x-0 top-0 h-1.5" />

      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="sound-text block font-mono text-5xl font-semibold leading-none">
            {profile.display}
          </span>
          <span className="label-mono mt-2 block text-ink-faint">
            as in “{profile.exampleWords[0]}”
          </span>
        </div>
        <span className="sound-text w-24 shrink-0 sm:w-28">
          <MouthDiagram sound={profile.id} />
        </span>
      </div>

      <p className="mt-4 text-[0.95rem] leading-relaxed text-ink-soft">
        {profile.description}
      </p>

      <ul className="mt-4 flex flex-wrap gap-1.5">
        {profile.exampleWords.slice(0, 4).map((word) => (
          <li
            key={word}
            className="rounded-full bg-paper-2 px-3 py-1 text-sm font-medium text-ink-soft"
          >
            {word}
          </li>
        ))}
      </ul>

      <div className="mt-5 flex items-center justify-between border-t border-line pt-4">
        <DifficultyDots level={profile.difficulty} />
        <span className="sound-text inline-flex items-center gap-1.5 text-sm font-semibold">
          {attemptCount > 0 ? `${attemptCount} attempt${attemptCount === 1 ? '' : 's'}` : 'Practise'}
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            className="transition-transform duration-200 group-hover:translate-x-1"
          >
            <path
              d="M3 8h9m0 0-3.4-3.4M12 8l-3.4 3.4"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </div>
    </Link>
  )
}
