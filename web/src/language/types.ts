/**
 * Language and phoneme knowledge — types.
 *
 * This layer holds what is true about *languages*. It holds nothing about a
 * learner. That separation is the point:
 *
 *   language/   what a sound is, where it occurs, how it is described
 *   db/         what this learner actually did, measured
 *
 * ## Naming
 *
 * `PhonemeProfile` here describes a **sound**. `PhonemeProfile` in `db/schema`
 * describes a **learner's history with a sound**. Both names were specified,
 * so the collision is inherited rather than chosen; they live in separate
 * modules and never appear in the same import. Where both are genuinely
 * needed, import this one as `PhonemeKnowledge`, which is exported as an
 * alias for exactly that purpose.
 *
 * ## On linguistic priors
 *
 * Nothing in this layer predicts that a learner will find a sound hard. The
 * `difficulty` figures are general statements about English sounds, and the
 * curriculum hints in a `LanguagePairProfile` describe relationships between
 * two languages' sound systems. Both are starting points for ordering an
 * assessment. **Measured results replace them.** A learner who produces a
 * clean /θ/ has a clean /θ/, whatever any table here suggests.
 */

/**
 * BCP-47-ish code.
 *
 * A learner whose first language is not listed types their own; that text is
 * stored as-is and every lookup here returns `undefined` for it, which is the
 * designed outcome rather than an error. They get the plain English ordering
 * instead of a bridge, because inventing one would be worse than having none.
 */
export type LanguageCode = 'en' | 'bn' | 'es'

/** Where in a word a sound occurs. */
export type WordPosition = 'initial' | 'medial' | 'final'

/** Broad manner class. Enough to group sounds; not a full feature system. */
export type PhonemeCategory =
  | 'fricative'
  | 'approximant'
  | 'stop'
  | 'nasal'
  | 'affricate'
  | 'vowel'

/**
 * 1–5, and a general property of the sound in English — not of any person.
 *
 *   1  most learners produce it without instruction
 *   3  commonly needs explicit practice
 *   5  hard to produce and hard to hear the difference
 */
export type Difficulty = 1 | 2 | 3 | 4 | 5

/**
 * A worked example. Hand-authored, never assembled at runtime — a generated
 * word list would eventually produce a word that does not contain the sound,
 * and the measurement downstream would then be of the wrong thing.
 */
export interface PhonemeExample {
  word: string
  position: WordPosition
  /**
   * A word differing only in the target sound, where a well-known one exists.
   * Display and contrast practice only; never itself measured as the target.
   */
  contrast?: string
  /** What the contrast turns it into, e.g. 'th' for sink/think. */
  contrastPhoneme?: string
}

/**
 * What is true about one sound in one language.
 *
 * @see PhonemeKnowledge — the alias to use where the learner-model type of
 * the same name is also in scope.
 */
export interface PhonemeProfile {
  /** Internal key, matching the analyser's inventory where assessable. */
  id: string
  /** IPA symbol. Case matters: /θ/ is not /Θ/. */
  ipa: string
  /** How it is written in learner-facing copy, e.g. "/th/ as in think". */
  label: string
  language: LanguageCode
  category: PhonemeCategory
  voiced: boolean
  /** Positions this sound occurs in, in this language. */
  positions: WordPosition[]
  difficulty: Difficulty
  /** One or two sentences a learner can act on. Articulation, not theory. */
  description: string
  /** How to make it: where the tongue goes, what the air does. */
  articulation: string
  examples: PhonemeExample[]
  /**
   * Whether PhonoPlay can currently *measure* this sound.
   *
   * False means there is no acoustic reference profile for it, so it can be
   * taught and shown but not scored. Stating that here stops the rest of the
   * app from offering practice it cannot assess.
   */
  assessable: boolean
  /** Why not, when `assessable` is false. */
  assessmentNote?: string
}

/** Alias for files that also import the learner-model `PhonemeProfile`. */
export type PhonemeKnowledge = PhonemeProfile

/** A language PhonoPlay knows something about. */
export interface LanguageProfile {
  code: LanguageCode
  /** English name, for interface copy. */
  name: string
  /** The language's own name in its own script. */
  nativeName: string
  script: string
  direction: 'ltr' | 'rtl'
  /** Can be chosen as a learner's first language. */
  canBeNative: boolean
  /**
   * Can be chosen as a target — which means PhonoPlay has acoustic reference
   * data for it. False is a statement about our data, not about the language.
   */
  canBeTarget: boolean
  /** Shown where the choice is made, when `canBeTarget` is false. */
  targetNote?: string
  /** Phoneme ids this language contributes to the knowledge base. */
  phonemes: string[]
}

/**
 * A familiar sound to start from, when the learner's first language has one
 * articulated in the same place as the target.
 *
 * This describes two articulations. It is not a claim that anyone will
 * substitute one for the other.
 */
export interface ArticulatoryAnchor {
  /** As written in the native language, e.g. "থ". */
  grapheme: string
  ipa: string
  /** What the two sounds share, and what differs. */
  note: string
}

/**
 * A suggestion about where to start, for one language pair.
 *
 * `suggestedOrder` orders the *baseline assessment*, so a learner meets the
 * most informative sounds first. It is not a difficulty prediction, and it is
 * discarded the moment real measurements exist.
 */
export interface CurriculumHint {
  phoneme: string
  suggestedOrder: number
  /**
   * Why this sound is worth assessing early, stated as a fact about the two
   * sound systems rather than as a prediction about the learner.
   */
  rationale: string
  anchor?: ArticulatoryAnchor
}

/** native → target. */
export interface LanguagePairProfile {
  native: LanguageCode
  target: LanguageCode
  /** True when the two differ, i.e. this is cross-language learning. */
  crossLanguage: boolean
  hints: CurriculumHint[]
  /**
   * The standing caveat, carried on the data rather than left to whoever
   * renders it to remember.
   */
  note: string
}

/** One item in the baseline assessment. */
export interface AssessmentPrompt {
  phoneme: string
  /** What the learner says. Exactly what gets measured. */
  text: string
  position: WordPosition
  /** Shown alongside for contrast; never measured as the target. */
  contrast?: string
  /** One line telling the learner what to do. */
  instruction: string
}
