import { LANGUAGES, LANGUAGE_PAIRS, pairKey } from './languages.ts'
import type {
  AssessmentPrompt,
  LanguageCode,
  LanguagePairProfile,
  LanguageProfile,
  PhonemeExample,
  PhonemeProfile,
  WordPosition,
} from './types.ts'

/**
 * LanguageKnowledgeService — the only way to ask about languages or sounds.
 *
 * Every lookup goes through here so that language-specific knowledge stays in
 * one place. A component should never hold a list of phonemes, decide which
 * languages exist, or know that Bangla cannot be a target; it asks.
 *
 * Everything is synchronous. This is static knowledge held in memory, not
 * learner data — there is nothing to await, and making callers await it would
 * spread promises through the UI for no reason.
 *
 * Unknown inputs return empty results or `undefined` rather than throwing.
 * A stale link to a language that no longer exists should show an empty
 * state, not break the page.
 */

/** The only target default for the MVP. Future target profiles register here. */
export const DEFAULT_TARGET_LANGUAGE: LanguageCode = 'en'

export interface PhonemeQuery {
  /** Default 'en'. */
  target?: LanguageCode
  /**
   * When true, only sounds PhonoPlay can measure. Defaults to true, because
   * the common case is "what can this learner practise" and offering
   * unmeasurable practice is worse than offering less.
   */
  assessableOnly?: boolean
}

export interface AssessmentQuery {
  target?: LanguageCode
  /** Order the prompts by this pair's curriculum hints. */
  native?: LanguageCode
  /** Cap the number of prompts, keeping the ordering. */
  limit?: number
}

export const LanguageKnowledgeService = {
  /**
   * Every language a learner can pick as their first language.
   *
   * Includes languages that cannot be targets — being unable to *measure*
   * Bangla does not stop us personalising English practice for a Bangla
   * speaker.
   */
  getSupportedLanguages(): LanguageProfile[] {
    return Object.values(LANGUAGES).filter((language) => language.canBeNative)
  },

  /**
   * Languages that can be practised, i.e. the ones with acoustic reference
   * data. Deliberately narrower than `getSupportedLanguages()`.
   */
  getTargetLanguages(): LanguageProfile[] {
    return Object.values(LANGUAGES).filter((language) => language.canBeTarget)
  },

  getLanguage(code: string): LanguageProfile | undefined {
    return LANGUAGES[code as LanguageCode]
  },

  /**
   * The sounds of a target language.
   *
   * By default only the measurable ones. Pass `assessableOnly: false` to
   * include sounds PhonoPlay can explain but not score — the voiced /ð/ in
   * "this" is the one such case today.
   */
  getPhonemes(query: PhonemeQuery = {}): PhonemeProfile[] {
    const { target = DEFAULT_TARGET_LANGUAGE, assessableOnly = true } = query
    const all = this.getLanguage(target)?.phonemeInventory ?? []
    return assessableOnly ? all.filter((phoneme) => phoneme.assessable) : [...all]
  },

  getPhoneme(id: string, target: LanguageCode = DEFAULT_TARGET_LANGUAGE): PhonemeProfile | undefined {
    return this.getLanguage(target)?.phonemeInventory.find((phoneme) => phoneme.id === id)
  },

  /**
   * Worked examples for one sound, optionally narrowed to a word position.
   *
   * Returns `[]` for an unknown sound rather than throwing — a caller
   * rendering a list should show nothing, not crash.
   */
  getPhonemeExamples(
    id: string,
    options: { position?: WordPosition; target?: LanguageCode } = {},
  ): PhonemeExample[] {
    const phoneme = this.getPhoneme(id, options.target ?? 'en')
    if (!phoneme) return []
    if (!options.position) return [...phoneme.examples]
    return phoneme.examples.filter((example) => example.position === options.position)
  },

  /**
   * Examples that carry a minimal-pair contrast — the raw material for
   * contrast practice in Accessibility Mode.
   */
  getContrastExamples(id: string, target: LanguageCode = 'en'): PhonemeExample[] {
    return this.getPhonemeExamples(id, { target }).filter((example) =>
      Boolean(example.contrast),
    )
  },

  /**
   * The baseline assessment.
   *
   * When `native` is given, prompts are ordered by that pair's curriculum
   * hints so the most informative sounds come first. That ordering is a
   * starting point only: once the assessment produces measurements, those
   * decide what happens next.
   *
   * Every prompt is word-initial, because the analyser locates a target at
   * the start of an utterance. The phoneme knowledge records medial and final
   * positions honestly; the assessment sticks to what can be scored.
   */
  getAssessmentPrompts(query: AssessmentQuery = {}): AssessmentPrompt[] {
    const { target = DEFAULT_TARGET_LANGUAGE, native, limit } = query
    const prompts = [...(this.getLanguage(target)?.assessmentPrompts ?? [])]

    if (native) {
      const pair = this.getLanguagePairProfile(native, target)
      if (pair) {
        const order = new Map(pair.hints.map((hint) => [hint.phoneme, hint.suggestedOrder]))
        // Anything without a hint sorts last rather than first, so an
        // unlisted sound never displaces a deliberately prioritised one.
        const rank = (phoneme: string) => order.get(phoneme) ?? Number.MAX_SAFE_INTEGER
        prompts.sort((a, b) => rank(a.phoneme) - rank(b.phoneme))
      }
    }

    return typeof limit === 'number' ? prompts.slice(0, limit) : prompts
  },

  /**
   * What is known about one native → target pairing.
   *
   * Returns `undefined` when the pair has no researched profile. That is a
   * deliberate outcome: an invented bridge is worse than none, so callers
   * fall back to the plain target-language ordering instead of receiving a
   * guess.
   */
  getLanguagePairProfile(
    native: string,
    target: string = DEFAULT_TARGET_LANGUAGE,
  ): LanguagePairProfile | undefined {
    return LANGUAGE_PAIRS[pairKey(native as LanguageCode, target as LanguageCode)]
  },

  /**
   * The curriculum hint for one sound in one pairing, if there is one.
   *
   * Convenience for a UI showing "why this sound first" — the rationale is
   * meant to be visible, not buried in the data.
   */
  getHint(native: string, phoneme: string, target: string = DEFAULT_TARGET_LANGUAGE) {
    return this.getLanguagePairProfile(native, target)?.hints.find(
      (hint) => hint.phoneme === phoneme,
    )
  },
}

export type LanguageKnowledgeServiceType = typeof LanguageKnowledgeService
