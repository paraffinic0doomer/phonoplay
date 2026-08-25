import { ASSESSED_PHONEMES } from './plan.ts'
import type { Phoneme } from '../db/index.ts'

/**
 * Turning a set of measurements into the profile the learner is shown.
 *
 * The only arithmetic here is averaging. Everything else is about refusing to
 * report things the recordings did not support: a sound with no usable
 * recording gets no percentage, and a sound whose recordings were all
 * low-confidence is labelled as such rather than being quietly rounded into
 * the list beside sounds that were measured properly.
 */

/** One recording's result, as it came back from the acoustic stage. */
export interface AssessmentMeasurement {
  taskId: string
  phoneme: Phoneme
  /** 0-1 similarity to the target profile. Null when nothing was measured. */
  similarity: number | null
  confidence: number | null
  /** False when the stage measured the recording but named no sound. */
  assessed: boolean
}

/** Below this the evidence is too weak to present as a score. */
export const LOW_CONFIDENCE = 0.5

export interface PhonemeResult {
  phoneme: Phoneme
  /** 0-100, rounded. Null when nothing usable was recorded for this sound. */
  score: number | null
  /** Mean confidence across the recordings that counted. */
  confidence: number
  /** How many recordings were usable, out of how many were attempted. */
  usable: number
  attempted: number
  /**
   * True when there is a score but the evidence behind it is thin. The score
   * is still shown - hiding it would be its own distortion - but it is
   * labelled, and it is never chosen as the first focus.
   */
  lowConfidence: boolean
}

export interface PronunciationProfile {
  results: PhonemeResult[]
  /**
   * The sound to start with: the lowest-scoring one that was measured well
   * enough to act on. Null when nothing was measured confidently, which is a
   * real outcome and must not be filled in with a guess.
   */
  firstFocus: Phoneme | null
  /** True when at least one sound produced a usable score. */
  usable: boolean
  createdAt: string
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length
}

/**
 * Build the profile.
 *
 * A measurement counts only if the acoustic stage actually named a sound
 * (`assessed`). A recording it declined to score still carries a similarity
 * number, and averaging that in would let a reading the analyser refused to
 * stand behind move the learner's percentage.
 */
export function buildProfile(
  measurements: AssessmentMeasurement[],
  now: () => string = () => new Date().toISOString(),
): PronunciationProfile {
  const results: PhonemeResult[] = ASSESSED_PHONEMES.map((phoneme) => {
    const forPhoneme = measurements.filter((m) => m.phoneme === phoneme)
    const usable = forPhoneme.filter(
      (m) => m.assessed && m.similarity !== null,
    )

    if (usable.length === 0) {
      return {
        phoneme,
        score: null,
        confidence: 0,
        usable: 0,
        attempted: forPhoneme.length,
        lowConfidence: false,
      }
    }

    const score = Math.round(mean(usable.map((m) => m.similarity as number)) * 100)
    const confidence = mean(usable.map((m) => m.confidence ?? 0))

    return {
      phoneme,
      score,
      confidence: Number(confidence.toFixed(3)),
      usable: usable.length,
      attempted: forPhoneme.length,
      lowConfidence: confidence < LOW_CONFIDENCE,
    }
  })

  // The first focus has to be actionable, so it comes only from sounds that
  // were measured well. Picking the weakest score regardless of confidence
  // would send a learner to practise whichever sound happened to record worst.
  const actionable = results.filter(
    (result) => result.score !== null && !result.lowConfidence,
  )
  const firstFocus =
    actionable.length > 0
      ? actionable.reduce((lowest, result) =>
          (result.score as number) < (lowest.score as number) ? result : lowest,
        ).phoneme
      : null

  return {
    results,
    firstFocus,
    usable: results.some((result) => result.score !== null),
    createdAt: now(),
  }
}

/**
 * What to say above the list.
 *
 * Never a diagnosis, never a claim about the learner. It describes what the
 * recordings supported and what happens next.
 */
export function profileSummary(profile: PronunciationProfile): string {
  if (!profile.usable) {
    return 'We could not measure any of these sounds from those recordings. Nothing is wrong — try again somewhere quieter, and closer to the microphone.'
  }
  if (profile.firstFocus === null) {
    return 'These recordings were not clear enough to pick a starting sound with confidence. You can practise any of them, or record the assessment again.'
  }
  const scored = profile.results.filter((result) => result.score !== null).length
  return `Measured from ${scored} of ${profile.results.length} sounds. Percentages are how closely each recording matched the reference for that sound.`
}
