import { getContrastProfile } from '../db/contrasts.ts'
import { getProfile } from '../db/phonemes.ts'
import { getSettings } from '../db/settings.ts'
import type { Phoneme } from '../db/schema.ts'
import type { ExerciseEvidence } from '../lib/api.ts'

/**
 * Assemble what the exercise generator is told.
 *
 * The learner model lives in this browser, so the server has nothing to look
 * up — the evidence travels with the request. This function is the single
 * place that decides what leaves the device for that purpose, which makes it
 * the place to check that nothing personal does.
 *
 * What is sent: the target sound, the numbers the acoustic stage produced,
 * where the learner is on the ladder, which mode they chose, and the two
 * language codes. What is not: any identifier, any timestamp, any raw audio,
 * and nothing that could distinguish one learner from another.
 */

/** The pair most worth contrasting for each sound, when one is recorded. */
const PRIMARY_CONTRAST: Record<Phoneme, string> = {
  s: 's-th',
  th: 's-th',
  r: 'l-r',
  l: 'l-r',
}

export async function evidenceFor(
  phoneme: Phoneme,
  exerciseType = 'production',
): Promise<ExerciseEvidence> {
  const [profile, settings, contrast] = await Promise.all([
    getProfile(phoneme),
    getSettings(),
    getContrastProfile(PRIMARY_CONTRAST[phoneme], phoneme),
  ])

  return {
    target_phoneme: phoneme,
    // Null rather than zero before anything was measured: a brand-new learner
    // has no mastery, which is not the same as a mastery of nought, and the
    // generator pitches very differently for the two.
    mastery: profile.attempts === 0 ? null : profile.masteryScore,
    confidence: profile.attempts === 0 ? null : profile.confidence,
    recent_scores: profile.recentScores,
    current_stage: profile.currentStage,
    learning_mode: settings.learningMode,
    exercise_type: exerciseType,
    contrast_accuracy: contrast.attempts === 0 ? null : contrast.accuracy,
    native_language: settings.nativeLanguage,
    target_language: settings.targetLanguage,
  }
}
