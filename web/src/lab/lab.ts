import { RECENT_SCORES_KEPT } from '../db'
import type { Phoneme, PhonemeProfile } from '../db'
import type { PronunciationMeasurement } from '../types/api'
import { PHONEME_LABEL } from '../practice/material.ts'

/**
 * The Sound Lab's own logic: what to compare, and what to offer next.
 *
 * Two rules run through all of it.
 *
 * **A number on this screen is a practice similarity, never a clinical
 * measurement.** The wording lives in `SIMILARITY_LABEL` and
 * `SIMILARITY_CAVEAT` so it is written once and cannot drift between the
 * before/after strip, the headline and the accessibility view.
 *
 * **Nothing is shown that was not measured.** `deriveBeforeAfter` reads the
 * learner model's stored similarities and returns null when there are fewer
 * than two — a before/after with one real point and one invented one would be
 * the single most misleading thing this screen could draw.
 */

/** What the number is called, everywhere. */
export const SIMILARITY_LABEL = 'Practice similarity'

/** What it is, in one line, wherever the number is shown large. */
export const SIMILARITY_CAVEAT =
  'How closely this recording matched the reference pattern for the sound. ' +
  'A practice measure for tracking your own attempts — not a clinical or ' +
  'diagnostic score.'

/* ── Before and after ─────────────────────────────────────────────────── */

export interface BeforeAfter {
  /** Every assessed similarity still held for this sound, oldest first, 0–1. */
  points: number[]
  first: number
  current: number
  /** Change in percentage points, rounded. Can be negative. */
  deltaPoints: number
  /** 1-based position of `first` in the learner's whole history for this sound. */
  firstAttemptNumber: number
  currentAttemptNumber: number
  /** True when `first` genuinely is their earliest recorded attempt. */
  firstIsEarliest: boolean
}

/**
 * First against latest, from stored measurements only.
 *
 * `recentScores` holds the last `RECENT_SCORES_KEPT` assessed similarities and
 * `attempts` counts every assessed attempt ever, so the two together place the
 * window inside the whole history. Past ten attempts the earliest point is no
 * longer the first one, and the UI has to say "attempt 4" rather than "first
 * attempt" — which is why `firstIsEarliest` is returned instead of assumed.
 *
 * Null below two points. One measurement is not a comparison, and pairing it
 * with a zero would manufacture an improvement out of nothing.
 */
export function deriveBeforeAfter(profile: PhonemeProfile): BeforeAfter | null {
  const points = profile.recentScores
  if (points.length < 2) return null

  const first = points[0]
  const current = points[points.length - 1]
  // Guards a profile written before `attempts` and `recentScores` were kept in
  // step; the window can never be longer than the history it came from.
  const total = Math.max(profile.attempts, points.length)
  const firstAttemptNumber = total - points.length + 1

  return {
    points,
    first,
    current,
    deltaPoints: Math.round(current * 100) - Math.round(first * 100),
    firstAttemptNumber,
    currentAttemptNumber: total,
    firstIsEarliest: firstAttemptNumber === 1 && points.length <= RECENT_SCORES_KEPT,
  }
}

/** "First attempt" only when it was. Otherwise say which attempt it was. */
export function beforeLabel(comparison: BeforeAfter): string {
  return comparison.firstIsEarliest
    ? 'First attempt'
    : `Attempt ${comparison.firstAttemptNumber}`
}

export const AFTER_LABEL = 'Current attempt'

/* ── The next small step ──────────────────────────────────────────────── */

export interface NextStep {
  /** One short instruction. Always something the learner can do right now. */
  headline: string
  /** Why this is the step, in one line. */
  detail: string
  /** Where it goes, when it leaves the lab. */
  to?: string
  linkLabel?: string
}

/**
 * Contrast pairs that exist, for the substitutions they cover.
 *
 * Keyed `target:measured`. Only the pairs `contrast/pairs.ts` actually
 * defines appear here — the acoustic stage can name /ʃ/, /f/ or /w/, and
 * offering a lab for a pair that does not exist would be a dead link. When
 * there is no pair the step simply has no link, which is a complete step.
 */
const CONTRAST_ROUTE: Record<string, string> = {
  'r:l': '/contrast/l-r',
  'l:r': '/contrast/l-r',
  'th:t': '/contrast/t-th',
}

/**
 * One step, chosen from what was measured.
 *
 * Deliberately one. The accessibility brief asks for a next *small* step, and
 * a screen offering four routes forward is a screen that has not decided —
 * which is a cognitive load of its own.
 *
 * Nothing here is punitive: every branch, including the ones reached by a poor
 * recording, offers a way forward rather than reporting a failure.
 */
export function nextStep(
  result: Pick<PronunciationMeasurement, 'assessed' | 'status' | 'estimated_match' | 'similarity_score'>,
  sound: Phoneme,
): NextStep {
  const label = PHONEME_LABEL[sound]

  if (result.status === 'unusable_audio') {
    return {
      headline: 'Record it once more',
      detail:
        'The recording itself could not carry a measurement. Somewhere quieter, or a little closer to the microphone, usually fixes it.',
    }
  }

  if (!result.assessed) {
    return {
      headline: `Say ${label} once more, a little longer`,
      detail:
        'The recording was fine — there just was not enough of the sound in it to measure. Holding it slightly longer gives the analysis more to work with.',
    }
  }

  if (result.estimated_match && result.estimated_match !== sound) {
    const route = CONTRAST_ROUTE[`${sound}:${result.estimated_match}`]
    return {
      headline: `Practise ${label} against the sound it measured like`,
      detail:
        'Putting the two side by side is the fastest way to hear the difference and then make it.',
      ...(route ? { to: route, linkLabel: 'Open the contrast lab' } : {}),
    }
  }

  if (result.similarity_score >= 0.75) {
    return {
      headline: `Take ${label} into a whole word`,
      detail: 'The sound on its own is holding up. The next rung puts it in front of a vowel.',
      to: `/practice/${sound}`,
      linkLabel: 'Continue practising',
    }
  }

  return {
    headline: `Say ${label} once more`,
    detail: 'Repetition on the same sound is what moves this number. One more recording is the whole step.',
  }
}

/* ── Plain language ───────────────────────────────────────────────────── */

/**
 * The one-line explanation, in plain words.
 *
 * Prefers the backend's own sentence. `message` comes from
 * `api/app/acoustic/feedback.py` — a deterministic bank, written for learners,
 * reviewed against the accessibility language rules in CLAUDE.md. Rewriting it
 * here would give the same idea two wordings that could drift apart, and the
 * one in the API is the one that has been checked.
 *
 * The fallbacks below only cover a response with no message at all.
 */
export function plainExplanation(
  result: Pick<PronunciationMeasurement, 'message' | 'assessed' | 'status'>,
  sound: Phoneme,
): string {
  if (result.message) return result.message
  if (result.status === 'unusable_audio') {
    return 'This recording could not be measured. That is about the recording, not about you.'
  }
  if (!result.assessed) {
    return `There was not enough of ${PHONEME_LABEL[sound]} in that recording to measure it.`
  }
  return `That recording was measured against the reference pattern for ${PHONEME_LABEL[sound]}.`
}
