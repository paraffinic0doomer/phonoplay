import { ENGLISH_PHONEMES } from './english.ts'
import type { LanguageCode, LanguagePairProfile, LanguageProfile } from './types.ts'

/**
 * Languages, and what pairing two of them is allowed to imply.
 *
 * ## Two languages, honestly
 *
 * English and Bangla. Bangla can be a learner's first language but not a
 * target, because PhonoPlay has no acoustic reference data for Bangla. That
 * is a statement about our data, not about the language, and the picker says
 * so at the point the choice is made.
 *
 * ## What a language pair does NOT say
 *
 * The hints below order the **baseline assessment** so a learner meets the
 * most informative sounds first. They are not predictions.
 *
 * In particular, the fact that a sound is absent from a language's inventory
 * is not evidence that a speaker of it will struggle with that sound. Plenty
 * of people produce sounds their first language does not contain, and a
 * learner's actual recording is the only thing that settles it. Every hint is
 * therefore phrased as a description of two sound systems, and every one is
 * discarded as soon as a measurement exists.
 */

export const LANGUAGES: Record<LanguageCode, LanguageProfile> = {
  en: {
    code: 'en',
    name: 'English',
    nativeName: 'English',
    script: 'Latin',
    direction: 'ltr',
    canBeNative: true,
    canBeTarget: true,
    phonemes: ENGLISH_PHONEMES.map((p) => p.id),
  },
  es: {
    code: 'es',
    name: 'Spanish',
    nativeName: 'Español',
    script: 'Latin',
    direction: 'ltr',
    canBeNative: true,
    canBeTarget: false,
    targetNote:
      'PhonoPlay does not measure Spanish pronunciation yet — the acoustic ' +
      'reference data is English only. Spanish can be your first language ' +
      'here.',
    // Selectable as a first language, but there is no researched
    // Spanish-to-English bridge yet, so `getLanguagePairProfile('es', 'en')`
    // returns undefined and the assessment falls back to the plain English
    // ordering. That is the honest behaviour: an invented anchor would be
    // worse than none.
    phonemes: [],
  },
  bn: {
    code: 'bn',
    name: 'Bangla',
    nativeName: 'বাংলা',
    script: 'Bengali',
    direction: 'ltr',
    canBeNative: true,
    // No Bangla reference audio exists, so there is nothing to measure a
    // Bangla target against. Inventing one would be fabrication.
    canBeTarget: false,
    targetNote:
      'PhonoPlay does not measure Bangla pronunciation yet — the acoustic ' +
      'reference data is English only. Bangla can be your first language ' +
      'here, and practice is personalized for it.',
    // Bangla contributes anchors rather than practice targets, so it lists no
    // phonemes of its own in the knowledge base yet.
    phonemes: [],
  },
}

/**
 * The caveat that travels with every pair profile.
 *
 * Carried on the data rather than left to whichever component renders it to
 * remember to say.
 */
const OVERRIDE_NOTE =
  'These are starting points for what to assess first, not predictions about ' +
  'any learner. Measured results replace them.'

/**
 * Bangla → English.
 *
 * Each anchor is a **shared place of articulation** — a description of two
 * articulations, chosen because starting from a sound someone already makes
 * is better teaching than starting from nothing.
 *
 * Bangla's dental stop series (ত থ দ ধ) is laminal dental, the same region
 * English /θ/ uses. ল and English /l/ both make alveolar contact. র is an
 * alveolar tap or trill in the region English /ɹ/ approaches without
 * touching.
 */
const BN_EN: LanguagePairProfile = {
  native: 'bn',
  target: 'en',
  crossLanguage: true,
  hints: [
    {
      phoneme: 'th',
      suggestedOrder: 1,
      rationale:
        'Bangla has a dental stop series (ত থ দ ধ) made at the same place ' +
        'as English /θ/. Assessing it early is informative because the ' +
        'place is already familiar and only the manner differs — a stop ' +
        'closes the airflow, a fricative keeps it going.',
      anchor: {
        grapheme: 'থ',
        ipa: 't̪ʰ',
        note:
          'থ already puts your tongue tip at your teeth — the same place ' +
          'English /θ/ uses. The difference is what the air does: থ stops ' +
          'it, /θ/ keeps it flowing.',
      },
    },
    {
      phoneme: 'r',
      suggestedOrder: 2,
      rationale:
        'র is an alveolar tap or trill; English /ɹ/ approaches the same ' +
        'region without making contact. Same neighbourhood, different manner.',
      anchor: {
        grapheme: 'র',
        ipa: 'ɾ ~ r',
        note:
          'র taps or trills the tongue against the ridge behind your top ' +
          'teeth. English /r/ moves toward that same region but never ' +
          'touches.',
      },
    },
    {
      phoneme: 's',
      suggestedOrder: 3,
      rationale:
        'স is written for a sibilant, and across Bangla varieties it is ' +
        'produced as [s] or as [ʃ]. Assessing it establishes which one this ' +
        'learner is producing rather than assuming.',
      anchor: {
        grapheme: 'স',
        ipa: 's ~ ʃ',
        note:
          'স is a sibilant you already make. English /s/ is consistently ' +
          'the higher, sharper of the two.',
      },
    },
    {
      phoneme: 'l',
      suggestedOrder: 4,
      rationale:
        'ল and English /l/ are both alveolar laterals. This is the closest ' +
        'pairing of the four, so it is assessed last — it is the least ' +
        'likely to be informative early on.',
      anchor: {
        grapheme: 'ল',
        ipa: 'l',
        note:
          'ল and English /l/ are both made with the tongue tip touching the ' +
          'ridge behind the top teeth.',
      },
    },
  ],
  note: OVERRIDE_NOTE,
}

/**
 * English → English.
 *
 * No cross-language anchor, because there is nothing to bridge from. Ordered
 * by the general difficulty of the sounds in English, which is a property of
 * the sounds rather than of the speaker.
 *
 * This is not a degraded path. It is simply the case where the learner's
 * first language is the one they are practising.
 */
const EN_EN: LanguagePairProfile = {
  native: 'en',
  target: 'en',
  crossLanguage: false,
  hints: [
    {
      phoneme: 'th',
      suggestedOrder: 1,
      rationale:
        '/θ/ is among the later sounds to settle in English and is easily ' +
        'confused with /f/ and /s/, so it is informative to assess first.',
    },
    {
      phoneme: 'r',
      suggestedOrder: 2,
      rationale:
        'English /ɹ/ is articulated without contact, which makes it unusual ' +
        'and worth establishing early.',
    },
    {
      phoneme: 's',
      suggestedOrder: 3,
      rationale:
        '/s/ is loud and well-defined acoustically, so a reading of it is ' +
        'reliable and gives a good reference point for the others.',
    },
    {
      phoneme: 'l',
      suggestedOrder: 4,
      rationale:
        '/l/ has clear tongue contact and is generally the most stable of ' +
        'the four.',
    },
  ],
  note: OVERRIDE_NOTE,
}

/** Keyed `native>target`. */
export const LANGUAGE_PAIRS: Record<string, LanguagePairProfile> = {
  'bn>en': BN_EN,
  'en>en': EN_EN,
}

export function pairKey(native: LanguageCode, target: LanguageCode): string {
  return `${native}>${target}`
}
