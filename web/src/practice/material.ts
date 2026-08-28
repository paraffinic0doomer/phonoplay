import type { Phoneme, SkillType } from '../db'

/**
 * What the learner says, at each rung, for each sound.
 *
 * Curated rather than generated. CLAUDE.md allows the language model to write
 * practice content, but this is the content the *measurement* runs on, and a
 * generated word carries no guarantee that its target sound sits where the
 * analyser looks. Every item below puts the target at the start of the
 * utterance, because that is where `app/acoustic/` locates it and where its
 * reference profiles were measured.
 *
 * Minimal pairs are true minimal pairs — one phoneme apart, both real English
 * words. "sun" against "thumb" differs in three places and teaches nothing
 * about the contrast.
 *
 * ── The isolated-sound rung ──────────────────────────────────────────────
 *
 * /s/ and /θ/ are fricatives: sustained on their own they are exactly what
 * the analyser measures, so the `sound` stage asks for the bare sound.
 *
 * /r/ and /l/ are approximants, identified by how the formants move into the
 * *following vowel*. There is no vowel in an isolated /r/, so there is
 * nothing to measure. Their `sound` rung therefore uses the shortest vehicle
 * that can carry the sound — the consonant plus a neutral vowel — and the
 * instruction says so rather than pretending a bare sound was scored.
 */

export interface PracticeItem {
  /** What appears on screen, large. */
  text: string
  /** One line telling the learner what to do with it. */
  instruction: string
  /** The near-identical word, for a minimal-pair rung. Never the target. */
  contrast?: string
  /**
   * True when the text is a vehicle for a sound that cannot be measured
   * alone, rather than the sound itself. Shown to the learner.
   */
  vehicle?: boolean
}

type Bank = Record<Phoneme, Partial<Record<SkillType, PracticeItem[]>>>

const BANK: Bank = {
  s: {
    sound: [
      { text: 'sss', instruction: 'Hold the hiss for about two seconds.' },
      { text: 'sss', instruction: 'Again — keep the air narrow and steady.' },
    ],
    syllable: [
      { text: 'sah', instruction: 'Say it once, starting with the hiss.' },
      { text: 'see', instruction: 'Say it once, letting the hiss run into the vowel.' },
    ],
    word: [
      { text: 'sun', instruction: 'Say the word once, clearly.' },
      { text: 'sock', instruction: 'Say the word once.' },
      { text: 'sing', instruction: 'Say the word once. Start the hiss before the vowel.' },
    ],
    minimal_pair: [
      { text: 'sink', contrast: 'think', instruction: 'Say the first word only.' },
      { text: 'sing', contrast: 'thing', instruction: 'Say the first word only.' },
    ],
    phrase: [
      { text: 'Seven silver spoons', instruction: 'Say the whole phrase at a comfortable pace.' },
      { text: 'Sam sings softly', instruction: 'Say the whole phrase once.' },
    ],
    sentence: [
      { text: 'Sam sings a silly song.', instruction: 'Say the sentence as you normally would.' },
      { text: 'Sunday is a slow day.', instruction: 'Say the sentence once, at your own pace.' },
    ],
  },
  r: {
    sound: [
      { text: 'ruh', vehicle: true, instruction: 'Say the R with a short vowel after it.' },
      { text: 'ruh', vehicle: true, instruction: 'Again — keep your lips relaxed, not rounded.' },
    ],
    syllable: [
      { text: 'rah', instruction: 'Say it once, holding the R before the vowel.' },
      { text: 'roh', instruction: 'Say it once.' },
    ],
    word: [
      { text: 'red', instruction: 'Say the word once, with your lips relaxed.' },
      { text: 'rag', instruction: 'Say the word once, holding the R before the vowel.' },
      { text: 'rain', instruction: 'Say the word once.' },
    ],
    minimal_pair: [
      { text: 'rake', contrast: 'wake', instruction: 'Say the first word only.' },
      { text: 'red', contrast: 'wed', instruction: 'Say the first word only.' },
      { text: 'rice', contrast: 'lice', instruction: 'Say the first word only.' },
    ],
    phrase: [
      { text: 'Red rabbits run', instruction: 'Say the whole phrase at a comfortable pace.' },
      { text: 'Rain on the roof', instruction: 'Say the whole phrase once.' },
    ],
    sentence: [
      { text: 'Rabbits run around the red barn.', instruction: 'Say the sentence as you normally would.' },
      { text: 'Rachel read the whole report.', instruction: 'Say the sentence once, at your own pace.' },
    ],
  },
  l: {
    sound: [
      { text: 'luh', vehicle: true, instruction: 'Say the L with a short vowel after it.' },
      { text: 'luh', vehicle: true, instruction: 'Again — tongue tip on the ridge behind your top teeth.' },
    ],
    syllable: [
      { text: 'lah', instruction: 'Say it once, touching the ridge behind your top teeth.' },
      { text: 'loh', instruction: 'Say it once.' },
    ],
    word: [
      { text: 'light', instruction: 'Say the word once, touching the ridge behind your top teeth.' },
      { text: 'lace', instruction: 'Say the word once, slowly.' },
      { text: 'lake', instruction: 'Say the word once.' },
    ],
    minimal_pair: [
      { text: 'lake', contrast: 'rake', instruction: 'Say the first word only.' },
      { text: 'light', contrast: 'right', instruction: 'Say the first word only.' },
      { text: 'lace', contrast: 'race', instruction: 'Say the first word only.' },
    ],
    phrase: [
      { text: 'Little lions laugh', instruction: 'Say the whole phrase at a comfortable pace.' },
      { text: 'Look at the lake', instruction: 'Say the whole phrase once.' },
    ],
    sentence: [
      { text: 'Lucy left her lunch at home.', instruction: 'Say the sentence as you normally would.' },
      { text: 'Long letters take a little longer.', instruction: 'Say the sentence once, at your own pace.' },
    ],
  },
  th: {
    sound: [
      { text: 'thhh', instruction: 'Hold it for about two seconds, tongue at your top teeth.' },
      { text: 'thhh', instruction: 'Again — this sound is quieter than a hiss.' },
    ],
    syllable: [
      { text: 'thah', instruction: 'Say it once, tongue tip lightly at the teeth.' },
      { text: 'thoh', instruction: 'Say it once.' },
    ],
    word: [
      { text: 'think', instruction: 'Say the word once. This sound is quieter than a hiss.' },
      { text: 'thank', instruction: 'Say the word once, with the tongue at your top teeth.' },
      { text: 'three', instruction: 'Say the word once.' },
    ],
    minimal_pair: [
      { text: 'thin', contrast: 'tin', instruction: 'Say the first word only.' },
      { text: 'thick', contrast: 'tick', instruction: 'Say the first word only.' },
      { text: 'three', contrast: 'tree', instruction: 'Say the first word only.' },
    ],
    phrase: [
      { text: 'Think three thoughts', instruction: 'Say the whole phrase at a comfortable pace.' },
      { text: 'Thank them both', instruction: 'Say the whole phrase once.' },
    ],
    sentence: [
      { text: 'Thank you for the three books.', instruction: 'Say the sentence as you normally would.' },
      { text: 'Thursday is the third day here.', instruction: 'Say the sentence once, at your own pace.' },
    ],
  },
}

/** What this sound is called, for instructions and screen readers. */
export const PHONEME_NAME: Record<Phoneme, string> = {
  s: 'the S sound',
  r: 'the R sound',
  l: 'the L sound',
  th: 'the TH sound',
}

/** How the sound is written on screen. */
export const PHONEME_LABEL: Record<Phoneme, string> = {
  s: '/S/',
  r: '/R/',
  l: '/L/',
  th: '/TH/',
}

/** What a rung is called for a learner, who does not think in skill types. */
export const STAGE_LABEL: Record<SkillType, string> = {
  sound: 'Sound',
  syllable: 'Syllable',
  minimal_pair: 'Sound pair',
  word: 'Word',
  phrase: 'Phrase',
  sentence: 'Sentence',
}

/** One line on what this rung is for. */
export const STAGE_PURPOSE: Record<SkillType, string> = {
  sound: 'The sound on its own, with nothing else to get in the way.',
  syllable: 'The sound running into a vowel — the smallest step up.',
  minimal_pair: 'Two words that differ by this one sound.',
  word: 'The sound at the start of a whole word.',
  phrase: 'The same sound inside a few words together.',
  sentence: 'The sound in ordinary connected speech.',
}

/**
 * Pick an item for this sound and rung.
 *
 * Rotates by attempt number so a learner repeating a stage — which
 * Accessibility Mode expects them to do many times — is not handed the same
 * word over and over. Deterministic, so returning to a stage shows the same
 * thing rather than something new every render.
 */
export function itemFor(
  phoneme: Phoneme,
  stage: SkillType,
  attemptIndex = 0,
): PracticeItem {
  const items = BANK[phoneme]?.[stage] ?? BANK[phoneme]?.word
  if (!items || items.length === 0) {
    // Every phoneme has a word list, so this is unreachable in practice.
    return { text: PHONEME_LABEL[phoneme], instruction: 'Say the sound once.' }
  }
  return items[Math.abs(attemptIndex) % items.length]
}

/** Every item for a rung, for tests and for a "show me the others" view. */
export function itemsFor(phoneme: Phoneme, stage: SkillType): PracticeItem[] {
  return BANK[phoneme]?.[stage] ?? []
}

export { BANK as PRACTICE_BANK }
