/**
 * Language and phoneme knowledge.
 *
 * **The UI imports this and nothing else from here.** Components ask
 * `LanguageKnowledgeService` rather than holding their own list of sounds or
 * deciding for themselves which languages exist — which is what keeps
 * language-specific knowledge from spreading through the interface.
 *
 * This layer describes *languages*. It knows nothing about a learner; that
 * lives in `src/db`. See `types.ts` for the naming note about the two
 * different things called `PhonemeProfile`.
 */

export { LanguageKnowledgeService } from './service.ts'
export type { AssessmentQuery, PhonemeQuery } from './service.ts'

export { ENGLISH_ASSESSMENT_PROMPTS, ENGLISH_LANGUAGE_PROFILE, ENGLISH_PHONEMES } from './english.ts'
export { LANGUAGES, LANGUAGE_PAIRS, pairKey } from './languages.ts'

export type {
  ArticulatoryAnchor,
  AssessmentPrompt,
  CurriculumHint,
  Difficulty,
  LanguageCode,
  LanguagePairProfile,
  LanguageProfile,
  SupportedExerciseType,
  PhonemeCategory,
  PhonemeExample,
  // Exported under both names on purpose: `PhonemeKnowledge` is the alias to
  // use in files that also import the learner-model type of the same name.
  PhonemeKnowledge,
  PhonemeProfile,
  WordPosition,
} from './types.ts'
