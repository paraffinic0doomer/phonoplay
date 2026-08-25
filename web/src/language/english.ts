import type { AssessmentPrompt, PhonemeProfile } from './types.ts'

/**
 * English phoneme knowledge, hand-authored.
 *
 * Every word here was chosen deliberately. Nothing is assembled at runtime:
 * a generated list eventually yields a word that does not contain the sound,
 * and the measurement downstream would then be of something else entirely.
 *
 * ## /th/ is two sounds
 *
 * English writes ⟨th⟩ for two different phonemes:
 *
 *   /θ/  voiceless — think, bath
 *   /ð/  voiced    — this, mother
 *
 * Same place of articulation, different voicing, and they are separate
 * phonemes: *thigh* and *thy* differ only in it. Both are described here.
 *
 * **Only /θ/ can currently be measured.** The acoustic stage has a reference
 * profile for /θ/ and none for /ð/, so /ð/ carries `assessable: false`. It is
 * kept in the knowledge base because it is real and worth explaining, and
 * flagged so nothing offers practice that cannot be scored.
 *
 * ## Positions
 *
 * `positions` records where a sound genuinely occurs in English. That is
 * wider than what PhonoPlay measures today — the analyser locates a target at
 * the start of an utterance — which is why every assessment prompt below is
 * word-initial while the knowledge is not.
 */

export const ENGLISH_PHONEMES: PhonemeProfile[] = [
  {
    id: 's',
    ipa: 's',
    label: '/s/ as in "sun"',
    language: 'en',
    category: 'fricative',
    voiced: false,
    positions: ['initial', 'medial', 'final'],
    difficulty: 2,
    description:
      'A long, thin hiss. The loudest of the English fricatives, and the ' +
      'easiest to hear when it is not quite right.',
    articulation:
      'Tongue tip just behind the top teeth, teeth almost closed, and a ' +
      'narrow stream of air down a groove in the tongue.',
    examples: [
      { word: 'sun', position: 'initial', contrast: 'thumb', contrastPhoneme: 'th' },
      { word: 'sing', position: 'initial', contrast: 'thing', contrastPhoneme: 'th' },
      { word: 'sock', position: 'initial', contrast: 'shock', contrastPhoneme: 'sh' },
      { word: 'sank', position: 'initial', contrast: 'thank', contrastPhoneme: 'th' },
      { word: 'basket', position: 'medial' },
      { word: 'whisper', position: 'medial' },
      { word: 'bus', position: 'final' },
      { word: 'glass', position: 'final' },
    ],
    assessable: true,
  },
  {
    id: 'r',
    ipa: 'ɹ',
    label: '/r/ as in "red"',
    language: 'en',
    category: 'approximant',
    voiced: true,
    // Final /r/ is pronounced in rhotic accents (most of North America,
    // Ireland, Scotland) and not in non-rhotic ones (most of England,
    // Australia). Listed because the sound does occur there; a learner in a
    // non-rhotic setting simply will not produce it.
    positions: ['initial', 'medial', 'final'],
    difficulty: 4,
    description:
      'Made without the tongue touching anything. That is what makes it ' +
      'unusual: most consonants involve contact, and this one is defined by ' +
      'getting close and stopping.',
    articulation:
      'Bunch the back of the tongue up and back, or curl the tip. Keep the ' +
      'lips relaxed — rounding them turns /r/ into /w/.',
    examples: [
      { word: 'red', position: 'initial', contrast: 'wed', contrastPhoneme: 'w' },
      { word: 'ring', position: 'initial', contrast: 'wing', contrastPhoneme: 'w' },
      { word: 'rag', position: 'initial', contrast: 'wag', contrastPhoneme: 'w' },
      { word: 'race', position: 'initial', contrast: 'lace', contrastPhoneme: 'l' },
      { word: 'arrow', position: 'medial' },
      { word: 'orange', position: 'medial' },
      { word: 'car', position: 'final' },
      { word: 'four', position: 'final' },
    ],
    assessable: true,
  },
  {
    id: 'l',
    ipa: 'l',
    label: '/l/ as in "light"',
    language: 'en',
    category: 'approximant',
    voiced: true,
    positions: ['initial', 'medial', 'final'],
    difficulty: 2,
    description:
      'The tongue tip touches, and the air goes around the sides instead of ' +
      'over the top. English has two versions: a clear /l/ at the start of a ' +
      'word (light) and a darker one at the end (ball).',
    articulation:
      'Touch the tongue tip firmly to the ridge behind your top teeth and ' +
      'let the sound flow around both sides.',
    examples: [
      { word: 'light', position: 'initial', contrast: 'right', contrastPhoneme: 'r' },
      { word: 'lace', position: 'initial', contrast: 'race', contrastPhoneme: 'r' },
      { word: 'leaf', position: 'initial', contrast: 'reef', contrastPhoneme: 'r' },
      { word: 'lock', position: 'initial', contrast: 'rock', contrastPhoneme: 'r' },
      { word: 'yellow', position: 'medial' },
      { word: 'balloon', position: 'medial' },
      { word: 'ball', position: 'final' },
      { word: 'feel', position: 'final' },
    ],
    assessable: true,
  },
  {
    id: 'th',
    ipa: 'θ',
    label: '/th/ as in "think"',
    language: 'en',
    category: 'fricative',
    voiced: false,
    positions: ['initial', 'medial', 'final'],
    difficulty: 4,
    description:
      'A quiet sound — much softer than /s/ — made with the tongue at the ' +
      'teeth rather than behind them. It is genuinely hard to hear apart ' +
      'from /f/, for listeners as well as learners.',
    articulation:
      'Let the tongue tip touch, or peek just past, your top front teeth, ' +
      'and blow gently. It should be quieter than a hiss.',
    examples: [
      { word: 'think', position: 'initial', contrast: 'sink', contrastPhoneme: 's' },
      { word: 'thin', position: 'initial', contrast: 'fin', contrastPhoneme: 'f' },
      { word: 'thank', position: 'initial', contrast: 'sank', contrastPhoneme: 's' },
      { word: 'thumb', position: 'initial', contrast: 'sum', contrastPhoneme: 's' },
      { word: 'three', position: 'initial' },
      { word: 'birthday', position: 'medial' },
      { word: 'bath', position: 'final', contrast: 'bass', contrastPhoneme: 's' },
      { word: 'tooth', position: 'final' },
    ],
    assessable: true,
  },
  {
    id: 'dh',
    ipa: 'ð',
    label: '/th/ as in "this"',
    language: 'en',
    category: 'fricative',
    voiced: true,
    // Word-initial /ð/ is almost entirely function words — the, this, that,
    // they, there — which is why it is so frequent in running speech despite
    // appearing in few word types.
    positions: ['initial', 'medial', 'final'],
    difficulty: 4,
    description:
      'The voiced partner of /θ/: the same tongue position, but with the ' +
      'voice switched on. Compare "thigh" and "thy" — the only difference ' +
      'is the voicing.',
    articulation:
      'Exactly where /θ/ goes — tongue at the top teeth — but hum while you ' +
      'do it. You should feel your throat buzz.',
    examples: [
      { word: 'this', position: 'initial' },
      { word: 'that', position: 'initial' },
      { word: 'they', position: 'initial' },
      { word: 'mother', position: 'medial' },
      { word: 'weather', position: 'medial' },
      { word: 'breathe', position: 'final' },
      { word: 'smooth', position: 'final' },
    ],
    // Knowledge without measurement. Kept because it is real and worth
    // explaining; flagged so nothing offers practice it cannot score.
    assessable: false,
    assessmentNote:
      'PhonoPlay can explain this sound but cannot measure it yet — there is ' +
      'no acoustic reference for the voiced /th/. Practice is offered for ' +
      'the voiceless /th/ in "think".',
  },
]

/**
 * The baseline assessment.
 *
 * Two prompts per measurable sound, every one **word-initial**, because the
 * analyser locates a target at the start of an utterance. The knowledge above
 * records medial and final positions honestly; the assessment sticks to what
 * can actually be scored.
 *
 * Each pair puts the sound next to a different confusable, so a single wrong
 * answer says something specific rather than only "not right".
 */
export const ENGLISH_ASSESSMENT_PROMPTS: AssessmentPrompt[] = [
  {
    phoneme: 's',
    text: 'sun',
    position: 'initial',
    contrast: 'thumb',
    instruction: 'Say the word once, clearly.',
  },
  {
    phoneme: 's',
    text: 'sing',
    position: 'initial',
    contrast: 'thing',
    instruction: 'Say the word once. Start the hiss before the vowel.',
  },
  {
    phoneme: 'r',
    text: 'red',
    position: 'initial',
    contrast: 'wed',
    instruction: 'Say the word once, with your lips relaxed.',
  },
  {
    phoneme: 'r',
    text: 'rag',
    position: 'initial',
    contrast: 'wag',
    instruction: 'Say the word once, holding the /r/ before the vowel.',
  },
  {
    phoneme: 'l',
    text: 'light',
    position: 'initial',
    contrast: 'right',
    instruction: 'Say the word once, touching the ridge behind your top teeth.',
  },
  {
    phoneme: 'l',
    text: 'lace',
    position: 'initial',
    contrast: 'race',
    instruction: 'Say the word once, slowly.',
  },
  {
    phoneme: 'th',
    text: 'think',
    position: 'initial',
    contrast: 'sink',
    instruction: 'Say the word once. This sound is quieter than a hiss.',
  },
  {
    phoneme: 'th',
    text: 'thank',
    position: 'initial',
    contrast: 'sank',
    instruction: 'Say the word once, with the tongue at your top teeth.',
  },
]
