import type { CSSProperties } from 'react'
import { PHONEME_LABEL, PHONEME_NAME } from '../assessment/plan'
import { profileSummary } from '../assessment/profile'
import type { PhonemeResult, PronunciationProfile } from '../assessment/profile'
import { SOUND_PROFILES } from '../data/sounds'
import type { SoundId } from '../types/api'
import { Button } from './Button'
import { ErrorNotice } from './ErrorNotice'
import type { AppError } from '../state/session'

/**
 * The pronunciation profile.
 *
 * Every percentage here is the mean similarity of the learner's own
 * recordings to the reference for that sound. A sound with no usable
 * recording shows no percentage at all — not a zero, which would read as a
 * failed attempt rather than an absent measurement.
 *
 * The wording is about recordings, never about the learner. "We could not
 * measure this one" is a statement about audio; anything phrased as a
 * property of the person would be a claim this product has no basis to make.
 */

function Row({ result }: { result: PhonemeResult }) {
  const sound = result.phoneme as SoundId
  const profile = SOUND_PROFILES[sound]
  const measured = result.score !== null

  return (
    <li
      style={{ '--sound': profile.color } as CSSProperties}
      className="flex items-center gap-4 border-b border-line py-4 last:border-b-0"
    >
      <span className="sound-text w-20 shrink-0 font-mono text-2xl font-semibold">
        {PHONEME_LABEL[result.phoneme]}
      </span>

      <div className="min-w-0 flex-1">
        <div
          className="h-2.5 w-full overflow-hidden rounded-full bg-paper-2"
          role="img"
          aria-label={
            measured
              ? `${PHONEME_NAME[result.phoneme]}: ${result.score} percent match`
              : `${PHONEME_NAME[result.phoneme]}: not measured`
          }
        >
          {measured && (
            <span
              className="block h-full rounded-full bg-[var(--sound)] transition-[width] duration-700 ease-out"
              style={{ width: `${result.score}%` }}
            />
          )}
        </div>
        {result.lowConfidence && measured && (
          <p className="label-mono mt-1.5 text-ink-faint">
            Low confidence — measured, but not clearly
          </p>
        )}
        {!measured && (
          <p className="label-mono mt-1.5 text-ink-faint">
            {result.attempted === 0
              ? 'Not recorded'
              : `Could not measure ${result.attempted === 1 ? 'that recording' : 'those recordings'}`}
          </p>
        )}
      </div>

      <span className="w-16 shrink-0 text-right text-2xl font-bold tabular-nums text-ink">
        {measured ? `${result.score}%` : '—'}
      </span>
    </li>
  )
}

export function ProfileCard({
  profile,
  onContinue,
  busy = false,
  error = null,
  onRetry,
}: {
  profile: PronunciationProfile
  onContinue: () => void
  busy?: boolean
  error?: AppError | null
  onRetry?: () => void
}) {
  const focus = profile.firstFocus

  return (
    <main
      // --sound is set on the whole screen, not just the focus panel: the
      // primary button below is a `sound` variant, and with the variable
      // scoped to one child it resolved to nothing and rendered white on
      // white - an invisible call to action on the screen that has the only
      // one that matters.
      style={
        focus
          ? ({ '--sound': SOUND_PROFILES[focus as SoundId].color } as CSSProperties)
          : undefined
      }
      className="animate-rise mx-auto max-w-2xl px-5 py-10 sm:py-14"
    >
      <p className="label-mono text-ink-faint">Assessment complete</p>
      <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-ink sm:text-4xl">
        Pronunciation profile
      </h1>
      <p className="mt-4 text-base leading-relaxed text-ink-soft">
        {profileSummary(profile)}
      </p>

      <ul className="panel mt-8 list-none p-5 sm:p-6">
        {profile.results.map((result) => (
          <Row key={result.phoneme} result={result} />
        ))}
      </ul>

      {focus && (
        <div className="sound-tint mt-6 rounded-2xl p-5 sm:p-6">
          <p className="label-mono text-ink-faint">Where to start</p>
          <p className="mt-2 text-2xl font-bold text-ink">
            Your first focus: <span className="sound-text">{PHONEME_LABEL[focus]}</span>
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            It measured furthest from the reference of the sounds we could read
            clearly. Nothing here is fixed — it is where practice will show the
            most, starting today.
          </p>
        </div>
      )}

      <div className="mt-8 flex flex-wrap gap-3">
        <Button variant="sound" size="lg" onClick={onContinue} disabled={busy}>
          {busy ? 'Building your plan…' : focus ? `Practise ${PHONEME_LABEL[focus]}` : 'Choose a sound'}
        </Button>
      </div>

      {error && (
        <div className="mt-6">
          <ErrorNotice error={error} onRetry={onRetry} retryLabel="Build my plan again" />
        </div>
      )}

      {/* The measurement's own limits, next to the numbers rather than
          buried in a footer. */}
      <p className="mt-8 text-sm leading-relaxed text-ink-faint">
        These percentages describe the recordings you just made, not your
        speech in general. They can be affected by your microphone, the room,
        and how tired you are. PhonoPlay provides educational pronunciation
        feedback and is not a medical diagnosis.
      </p>
    </main>
  )
}
