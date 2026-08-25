import { STAGE_ORDER } from './schema.ts'
import type { LearningMode, PhonemeProfile, SkillType, Trend } from './schema.ts'

/**
 * The rules that turn a phoneme profile into a decision.
 *
 * Kept as data rather than scattered through the code that reads profiles,
 * for two reasons. The first is that Accessibility Mode has to be able to
 * differ — CLAUDE.md asks for smaller steps, more repetition, and slower
 * progression, and that is a change of thresholds, not a change of system.
 * The second is that these are judgement calls, and a judgement call written
 * as a named constant can be argued with. One buried in an `if` cannot.
 *
 * Nothing here decides how good a recording was. That is measured by
 * `app/acoustic/` and arrives as a similarity and a confidence. These rules
 * only decide what a run of those measurements is worth.
 */

export interface LearnerPolicy {
  /**
   * The practice ladder for this mode, easiest first.
   *
   * Per-mode rather than global because the two modes do not merely differ in
   * how many rungs they have — they differ in order. Accessibility Mode puts
   * minimal pairs *before* whole words, so a learner hears the contrast that
   * matters before being asked to produce it inside a word. Standard Mode
   * skips both syllables and pairs entirely.
   */
  stages: SkillType[]
  /** Mastery is never claimed from fewer assessed attempts than this. */
  minAttempts: number
  /** The mastery score itself must be at least this. */
  minMastery: number
  /**
   * The analyser's own confidence must average at least this.
   *
   * A run of high similarities the analyser was unsure about is not evidence
   * of mastery; it is evidence of a measurement problem.
   */
  minConfidence: number
  /** Recent scores must agree with each other at least this well. */
  minConsistency: number
  /** Trends that block a mastery claim however good the numbers look. */
  blockingTrends: Trend[]
  /** Attempts at the current stage before advancing is considered. */
  repetitionsToAdvance: number
  /**
   * Attempts at one stage after which the learner is plainly stuck and the
   * product should offer help rather than more of the same. Never a penalty:
   * nothing is taken away, and no stage is ever forced backwards.
   */
  repetitionsBeforeSupport: number
}

/**
 * Standard Mode.
 *
 * Three assessed attempts is the floor because two cannot show consistency
 * and one cannot show anything at all — "do not mark mastery from one good
 * attempt" is the rule this number exists to keep.
 */
export const STANDARD_POLICY: LearnerPolicy = {
  stages: ['sound', 'word', 'phrase', 'sentence'],
  minAttempts: 3,
  minMastery: 0.75,
  minConfidence: 0.6,
  minConsistency: 0.6,
  blockingTrends: ['declining', 'inconsistent'],
  repetitionsToAdvance: 3,
  repetitionsBeforeSupport: 8,
}

/**
 * Accessibility Mode.
 *
 * Stronger evidence before moving on, and far more patience about how long
 * that takes. Both directions matter and they are not the same thing:
 *
 *   - **More evidence.** Five attempts rather than three, higher consistency,
 *     higher confidence. A learner who benefits from smaller steps is poorly
 *     served by being advanced on a lucky pair of recordings.
 *   - **More tolerance.** Twice as many repetitions before the product treats
 *     someone as stuck. Repetition here is the method, not a symptom of
 *     failure, and nothing about staying on a stage reduces anything.
 *
 * The mastery bar is *not* raised. Requiring a higher score to progress would
 * mean asking more of the learners this mode exists to support. What is
 * raised is how much evidence is needed before we believe the score.
 */
export const ACCESSIBILITY_POLICY: LearnerPolicy = {
  stages: ['sound', 'syllable', 'minimal_pair', 'word', 'phrase', 'sentence'],
  minAttempts: 5,
  minMastery: 0.75,
  minConfidence: 0.65,
  minConsistency: 0.7,
  blockingTrends: ['declining', 'inconsistent'],
  repetitionsToAdvance: 5,
  repetitionsBeforeSupport: 16,
}

export function policyFor(mode: LearningMode): LearnerPolicy {
  return mode === 'accessibility' ? ACCESSIBILITY_POLICY : STANDARD_POLICY
}

/**
 * Where this stage sits on a ladder that may not contain it.
 *
 * Switching modes moves the goalposts: Standard has no `syllable` rung, and
 * Accessibility orders `minimal_pair` before `word`. A learner part-way up
 * one ladder has to land somewhere sensible on the other.
 *
 * The rule is to keep what they have earned and claim nothing more: take the
 * last rung on this ladder that they have already reached, measured against
 * the canonical order. Nobody is sent back to the beginning for changing
 * mode, and nobody is skipped forward past a rung they never practised.
 */
export function ladderIndex(stage: SkillType, ladder: SkillType[]): number {
  const exact = ladder.indexOf(stage)
  if (exact !== -1) return exact

  const reached = STAGE_ORDER.indexOf(stage)
  if (reached === -1) return 0

  let best = 0
  for (let i = 0; i < ladder.length; i++) {
    if (STAGE_ORDER.indexOf(ladder[i]) <= reached) best = i
  }
  return best
}

/** Why mastery was not granted. Empty means it was. */
export type MasteryBlocker =
  | 'too-few-attempts'
  | 'mastery-too-low'
  | 'confidence-too-low'
  | 'not-consistent-enough'
  | 'trend'

export interface MasteryVerdict {
  mastered: boolean
  /** Every reason, not just the first — a caller may want to show the nearest. */
  blockers: MasteryBlocker[]
}

/**
 * Is this sound mastered under these rules?
 *
 * All four kinds of evidence have to agree: enough attempts, a high enough
 * score, measurements the analyser stood behind, and scores that agree with
 * each other. A declining or inconsistent trend blocks it regardless — a
 * mastery claim that is already falling apart is not one worth making.
 */
export function assessMastery(
  profile: PhonemeProfile,
  policy: LearnerPolicy,
): MasteryVerdict {
  const blockers: MasteryBlocker[] = []

  if (profile.attempts < policy.minAttempts) blockers.push('too-few-attempts')
  if (profile.masteryScore < policy.minMastery) blockers.push('mastery-too-low')
  if (profile.confidence < policy.minConfidence) blockers.push('confidence-too-low')
  if (profile.consistency < policy.minConsistency) blockers.push('not-consistent-enough')
  if (policy.blockingTrends.includes(profile.trend)) blockers.push('trend')

  return { mastered: blockers.length === 0, blockers }
}

export interface StageVerdict {
  /** The stage to be on now. Unchanged unless every condition is met. */
  stage: SkillType
  advance: boolean
  /** True once the learner has been on this stage long enough to need help. */
  needsSupport: boolean
  blockers: MasteryBlocker[]
}

/**
 * Should this sound move up a rung?
 *
 * Advancing needs the same evidence as mastery *plus* time actually spent at
 * the current stage. The two are separate on purpose: mastery is about the
 * sound, repetition is about the rung, and someone can satisfy one without
 * the other.
 *
 * There is no path here that moves a learner *down*. A bad run keeps them
 * where they are, which is a pause, not a demotion.
 */
export function assessStage(
  profile: PhonemeProfile,
  policy: LearnerPolicy,
): StageVerdict {
  const { mastered, blockers } = assessMastery(profile, policy)
  const ladder = policy.stages
  const index = ladderIndex(profile.currentStage, ladder)
  const isLast = index === ladder.length - 1

  const repeatedEnough = profile.repetitionCount >= policy.repetitionsToAdvance
  const advance = mastered && repeatedEnough && !isLast

  const all = [...blockers]
  if (!repeatedEnough) all.push('too-few-attempts')

  return {
    // When the current stage is not on this mode's ladder — someone switched
    // modes mid-sound — `ladderIndex` has already placed them at the nearest
    // rung they have earned, so staying put means moving to *that*, never
    // backwards past work they have done.
    stage: advance ? ladder[index + 1] : ladder[index],
    advance,
    needsSupport: profile.repetitionCount >= policy.repetitionsBeforeSupport,
    blockers: [...new Set(all)],
  }
}
