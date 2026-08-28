import { RECENT_SCORES_KEPT, db, now } from './schema.ts'
import type { ContrastProfile, Phoneme, Trend } from './schema.ts'
import { deriveTrend, setContrastAccuracy } from './phonemes.ts'

/**
 * Minimal-pair state — the perception half of the learner model.
 *
 * Separate from phoneme profiles because these measure a different thing.
 * A phoneme profile answers "how close is this production to the reference";
 * a contrast profile answers "can this learner tell these two apart". Someone
 * can produce a good /r/ and still not hear it against /w/, and the practice
 * those two facts call for is not the same.
 *
 * One sound belongs to several pairs, and they can diverge — /r/ against /w/
 * may be solid while /r/ against /l/ is not. Rolling them into a single
 * number per sound would average away the distinction that decides what to
 * practise, so each pair keeps its own row.
 *
 * These come from choices, not from the microphone. Nothing here touches
 * mastery of a sound's production.
 */

/**
 * "th-s" and "s-th" are the same pair.
 *
 * Normalised on the way in so a caller cannot create two rows for one
 * contrast by naming it the other way round.
 */
export function normaliseContrast(contrast: string): string {
  return contrast
    .split(/[-/]/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join('-')
}

/**
 * The row id for a pair, derived from the pair itself.
 *
 * Deterministic rather than random, because `contrast` carries a unique
 * index and two callers reading the same pair at the same time both miss the
 * read below and both write. With random ids that is two different rows
 * competing for one unique key, and the second write fails:
 *
 *     ConstraintError: Unable to add key to index 'contrast'
 *
 * Reproduced with three concurrent reads, and reached in normal use by
 * React's double-invoked effects in development, or simply by two components
 * showing the same pair. Deriving the id means concurrent creates write the
 * same row and the last one wins, which is correct — they are identical.
 */
function contrastId(contrast: string): string {
  return `contrast-${contrast}`
}

function blank(contrast: string, phoneme: Phoneme): ContrastProfile {
  return {
    id: contrastId(contrast),
    contrast,
    phoneme,
    attempts: 0,
    correctAttempts: 0,
    accuracy: null,
    recentResults: [],
    trend: 'new',
    lastPracticed: null,
    updatedAt: now(),
  }
}

export async function getContrastProfile(
  contrast: string,
  phoneme: Phoneme,
): Promise<ContrastProfile> {
  const key = normaliseContrast(contrast)
  const existing = await db.contrastProfiles.where('contrast').equals(key).first()
  if (existing) return existing

  const created = blank(key, phoneme)
  await db.contrastProfiles.put(created)
  return created
}

/** Every pair recorded for one sound, most recently practised first. */
export async function getContrastProfiles(
  phoneme?: Phoneme,
): Promise<ContrastProfile[]> {
  const rows = phoneme
    ? await db.contrastProfiles.where('phoneme').equals(phoneme).toArray()
    : await db.contrastProfiles.toArray()
  return rows.sort((a, b) => (b.lastPracticed ?? '').localeCompare(a.lastPracticed ?? ''))
}

/**
 * Fold one right-or-wrong answer into the pair's state.
 *
 * The trend uses the same window and the same rule as a phoneme's, so
 * "improving" means the same thing on both. Correct answers are 1 and wrong
 * ones 0, which makes the recent window a moving accuracy and lets the shared
 * `deriveTrend` read it without a special case.
 */
export async function recordContrastResult(input: {
  contrast: string
  phoneme: Phoneme
  correct: boolean
}): Promise<ContrastProfile> {
  const profile = await getContrastProfile(input.contrast, input.phoneme)
  const timestamp = now()

  const attempts = profile.attempts + 1
  const correctAttempts = profile.correctAttempts + (input.correct ? 1 : 0)
  const recentResults = [...profile.recentResults, input.correct ? 1 : 0].slice(
    -RECENT_SCORES_KEPT,
  )

  const updated: ContrastProfile = {
    ...profile,
    attempts,
    correctAttempts,
    // Lifetime accuracy, not the recent window: this is the number a learner
    // would recognise as "how many did I get right".
    accuracy: Math.round((correctAttempts / attempts) * 1e4) / 1e4,
    recentResults,
    trend: deriveTrend(recentResults),
    lastPracticed: timestamp,
    updatedAt: timestamp,
  }
  await db.contrastProfiles.put(updated)

  // Keep the sound's rolled-up figure in step, so a caller holding only a
  // phoneme profile still sees perception reflected.
  await setContrastAccuracy(input.phoneme, updated.accuracy)
  return updated
}

/** Pairs the learner gets wrong more often than this need attention. */
export const CONTRAST_ATTENTION_BELOW = 0.7

/**
 * Pairs worth practising, weakest first.
 *
 * A pair with too few answers to mean anything is left out rather than ranked
 * on one lucky guess — with two options, a single correct answer is a coin
 * landing heads.
 */
export async function getContrastsNeedingWork(
  minAttempts = 3,
): Promise<ContrastProfile[]> {
  const rows = await getContrastProfiles()
  return rows
    .filter(
      (row) =>
        row.attempts >= minAttempts &&
        row.accuracy !== null &&
        row.accuracy < CONTRAST_ATTENTION_BELOW,
    )
    .sort((a, b) => (a.accuracy ?? 1) - (b.accuracy ?? 1))
}

export type { ContrastProfile, Trend }
