import type { Phoneme } from '../db/index.ts'

/**
 * The Sound Contrast Lab's inventory.
 *
 * Two sounds that differ in one feature, and words that differ only by those
 * two sounds. Telling them apart by ear and producing them distinctly are
 * separate skills, and this file is careful about which of them PhonoPlay can
 * actually support for each pair.
 *
 * ── What this is not ─────────────────────────────────────────────────────
 *
 * This is pronunciation practice. It is not a screener, and nothing it
 * produces says anything about a learner beyond how a handful of their
 * recordings and answers compared to a reference.
 *
 * The pairs below are chosen because they are acoustically close and because
 * the analyser can distinguish them — not because they are claimed to be
 * difficult for speakers of any particular language or any group of people.
 * A learner practises a contrast because their own measurements suggest it,
 * or because they chose it.
 */

/** Hearing the difference, and producing it. Not the same skill. */
export type ContrastMode = 'listen' | 'speak'

export interface ContrastSide {
  /** How it is written for the learner: "TH". */
  label: string
  /** Plain-language name, for instructions and screen readers. */
  name: string
  /**
   * The practice target the acoustic stage can measure, when there is one.
   *
   * Null means the analyser has no reference profile it can score this sound
   * *against as a target*. It may still be detectable as a candidate — /t/ is
   * exactly that: the analyser can report "this measured like /t/" while
   * having no way to score a recording as an attempt at /t/.
   */
  target: Phoneme | null
}

export interface MinimalPair {
  /** Word carrying the first sound. Sound is word-initial. */
  a: string
  /** Word carrying the second. Identical but for the contrast. */
  b: string
}

export interface Contrast {
  /** Normalised, and the key used in the learner model: "t-th". */
  id: string
  a: ContrastSide
  b: ContrastSide
  /** Only the modes this pair can honestly support. */
  modes: ContrastMode[]
  /** Why speaking is unavailable, when it is. Shown to the learner. */
  speakingNote?: string
  /** What separates the two sounds, in one line. Never a claim about people. */
  difference: string
  words: MinimalPair[]
  /** Connected speech, target word-initial so the analyser can find it. */
  phrase: string
  sentence: string
}

/**
 * TH / T.
 *
 * Fully supported. /th/ is a practice target and /t/ sits in its candidate
 * set, so a recording of "thin" produced as "tin" is measured as /th/ and
 * reported as having measured like /t/ — which is exactly what this pair
 * exists to surface.
 */
const TH_T: Contrast = {
  id: 't-th',
  a: { label: 'TH', name: 'the TH sound', target: 'th' },
  b: { label: 'T', name: 'the T sound', target: null },
  modes: ['listen', 'speak'],
  difference:
    'TH lets air flow continuously past the tongue tip. T stops the air completely, then releases it.',
  words: [
    { a: 'thin', b: 'tin' },
    { a: 'thick', b: 'tick' },
    { a: 'three', b: 'tree' },
    { a: 'thought', b: 'taught' },
  ],
  phrase: 'Three thin threads',
  sentence: 'Thank you for the third one.',
}

/**
 * R / L.
 *
 * The best-supported pair: both sides are practice targets, and each appears
 * in the other's candidate set, so production can be measured in either
 * direction.
 */
const R_L: Contrast = {
  id: 'l-r',
  a: { label: 'R', name: 'the R sound', target: 'r' },
  b: { label: 'L', name: 'the L sound', target: 'l' },
  modes: ['listen', 'speak'],
  difference:
    'For L the tongue tip touches the ridge behind the top teeth. For R it never touches anything.',
  words: [
    { a: 'right', b: 'light' },
    { a: 'rake', b: 'lake' },
    { a: 'road', b: 'load' },
    { a: 'rip', b: 'lip' },
  ],
  phrase: 'Red lorry, yellow lorry',
  sentence: 'Rain fell along the road.',
}

/**
 * F / V — listening only, and the reason is worth stating plainly.
 *
 * The acoustic stage has a reference profile for /f/ but none at all for /v/,
 * and neither is a practice target. Scoring a spoken attempt here would mean
 * producing a number with no reference behind it, and an F/V contrast that
 * cannot detect a /v/ said as /f/ would miss the only thing it is for.
 *
 * So the pair is offered for discrimination, where the work is done by the
 * learner's ear rather than by a measurement, and speaking is withheld rather
 * than faked. Adding it needs a /v/ reference corpus and /f/ and /v/ as
 * practice targets — see acoustic/reference/README.md.
 */
const F_V: Contrast = {
  id: 'f-v',
  a: { label: 'F', name: 'the F sound', target: null },
  b: { label: 'V', name: 'the V sound', target: null },
  modes: ['listen'],
  speakingNote:
    'Listening practice only for now. PhonoPlay has no reference recordings for V, so it cannot measure a spoken attempt at this pair — and a score with nothing behind it would be worse than none.',
  difference:
    'F and V are made the same way. The only difference is that V uses the voice and F does not.',
  words: [
    { a: 'fan', b: 'van' },
    { a: 'few', b: 'view' },
    { a: 'ferry', b: 'very' },
    { a: 'safe', b: 'save' },
  ],
  phrase: 'Five fine vans',
  sentence: 'Very few of them fell.',
}

export const CONTRASTS: Contrast[] = [TH_T, R_L, F_V]

export function getContrast(id: string): Contrast | undefined {
  return CONTRASTS.find((contrast) => contrast.id === id)
}

/** Pairs whose production can actually be measured. */
export function speakableContrasts(): Contrast[] {
  return CONTRASTS.filter((contrast) => contrast.modes.includes('speak'))
}

/** The side of a pair that has a measurable target, if either does. */
export function measurableSide(contrast: Contrast): ContrastSide | null {
  if (contrast.a.target) return contrast.a
  if (contrast.b.target) return contrast.b
  return null
}

/* ── Progression ──────────────────────────────────────────────────── */

/**
 * The lab's ladder.
 *
 * Distinct from the learner model's stage ladder (`db/policy.ts`), which
 * tracks one *sound* across the product. This one tracks one *pair*, and
 * starts before production: a learner hears the difference, then proves they
 * can hear it, before being asked to make it.
 */
export type LabStep =
  | 'listen'
  | 'discriminate'
  | 'repeat'
  | 'minimal_pair'
  | 'word'
  | 'phrase'
  | 'sentence'

export const LAB_STEPS: LabStep[] = [
  'listen',
  'discriminate',
  'repeat',
  'minimal_pair',
  'word',
  'phrase',
  'sentence',
]

export const STEP_LABEL: Record<LabStep, string> = {
  listen: 'Listen',
  discriminate: 'Tell them apart',
  repeat: 'Say the sound',
  minimal_pair: 'Say the pair',
  word: 'Say a word',
  phrase: 'Say a phrase',
  sentence: 'Say a sentence',
}

export const STEP_PURPOSE: Record<LabStep, string> = {
  listen: 'Hear both sounds side by side.',
  discriminate: 'One word plays. Choose which sound you heard.',
  repeat: 'Say the sound on its own. Practice — nothing is measured.',
  minimal_pair: 'Say the word you are asked for, from the pair.',
  word: 'Say the word on its own.',
  phrase: 'Say the whole phrase at a comfortable pace.',
  sentence: 'Say the whole sentence as you normally would.',
}

/** Steps that ask the learner to hear rather than speak. */
export const PERCEPTION_STEPS: LabStep[] = ['listen', 'discriminate']

/**
 * The steps this pair can offer.
 *
 * A listening-only pair stops after discrimination rather than presenting
 * production steps that would have to invent a result.
 */
export function stepsFor(contrast: Contrast): LabStep[] {
  return contrast.modes.includes('speak')
    ? LAB_STEPS
    : LAB_STEPS.filter((step) => PERCEPTION_STEPS.includes(step))
}

/**
 * Whether a step's recording feeds a pronunciation measurement.
 *
 * `repeat` is production but is not measured: a sound said on its own has no
 * following vowel, and /r/ and /l/ are identified by their formant
 * transitions into one. Scoring an isolated approximant would be measuring
 * something the reference profiles were never built from.
 */
export function isMeasured(step: LabStep): boolean {
  return step === 'minimal_pair' || step === 'word' || step === 'phrase' || step === 'sentence'
}
