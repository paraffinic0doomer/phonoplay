import type { SoundId } from '../types/api'

/**
 * Presentation catalogue for the four target sounds.
 *
 * The backend's GET /api/sounds supplies id / ipa / label / description.
 * Everything else here (articulation copy, mouth diagram geometry, colour)
 * is frontend content and stays on the client.
 */
export interface SoundProfile {
  id: SoundId
  /** Display form used in headings, e.g. "/S/". */
  display: string
  /** IPA symbol for the phoneme itself. */
  ipa: string
  label: string
  /** One line the learner reads on the selection screen. */
  description: string
  /** How the sound is made, in learner-facing language. */
  articulation: string
  /** 1–3. Reflects how hard the sound is to produce and to measure. */
  difficulty: 1 | 2 | 3
  difficultyNote: string
  /** CSS colour token for this sound. */
  color: string
  /**
   * TODO(api): replace with GET /api/prompts?sound=<id> once the prompt bank
   * is served. These are display-only samples for the selection screen and
   * are never sent to the analysis service.
   */
  exampleWords: string[]
  /** Sounds this one is commonly produced as. Mirrors confusions.py. */
  commonlyBecomes: string[]
}

export const SOUND_PROFILES: Record<SoundId, SoundProfile> = {
  s: {
    id: 's',
    display: '/S/',
    ipa: 's',
    label: 'The S sound',
    description: 'A long, thin stream of air over the tip of the tongue.',
    articulation:
      'Tongue tip close behind the top teeth, teeth almost touching. Push a steady stream of air down the middle of the tongue.',
    difficulty: 1,
    difficultyNote: 'Easy to hear, easy to measure.',
    color: 'var(--color-sound-s)',
    exampleWords: ['sun', 'sock', 'bus', 'grass', 'castle'],
    commonlyBecomes: ['θ', 'ʃ', 't', 'z'],
  },
  r: {
    id: 'r',
    display: '/R/',
    ipa: 'ɹ',
    label: 'The R sound',
    description: 'The tongue pulls back and bunches, lips stay relaxed.',
    articulation:
      'Pull the body of the tongue back and bunch it up, or curl the tip. Keep the lips relaxed — rounding them turns /r/ into /w/.',
    difficulty: 3,
    difficultyNote: 'The hardest English sound for most learners.',
    color: 'var(--color-sound-r)',
    exampleWords: ['rabbit', 'red', 'car', 'story', 'around'],
    commonlyBecomes: ['w', 'l', 'ʊ'],
  },
  l: {
    id: 'l',
    display: '/L/',
    ipa: 'l',
    label: 'The L sound',
    description: 'Tongue tip touches the ridge behind the top teeth.',
    articulation:
      'Press the tip of the tongue on the bumpy ridge behind your top teeth and let the sound flow around the sides.',
    difficulty: 2,
    difficultyNote: 'Straightforward at the start of a word, trickier at the end.',
    color: 'var(--color-sound-l)',
    exampleWords: ['lion', 'leaf', 'ball', 'yellow', 'little'],
    commonlyBecomes: ['w', 'ɹ', 'j'],
  },
  th: {
    id: 'th',
    display: '/TH/',
    ipa: 'θ',
    label: 'The TH sound',
    description: 'Tongue peeks between the teeth with a soft, quiet air flow.',
    articulation:
      'Let the tip of the tongue rest lightly between your teeth and blow gently. It should feel soft, not sharp.',
    difficulty: 3,
    difficultyNote: 'Quiet and breathy — the hardest of the four to measure confidently.',
    color: 'var(--color-sound-th)',
    exampleWords: ['thumb', 'think', 'bath', 'three', 'birthday'],
    commonlyBecomes: ['f', 's', 't', 'd'],
  },
}

export const SOUND_ORDER: SoundId[] = ['s', 'r', 'l', 'th']

export const SOUND_LIST: SoundProfile[] = SOUND_ORDER.map((id) => SOUND_PROFILES[id])

export function isSoundId(value: string | undefined): value is SoundId {
  return value === 's' || value === 'r' || value === 'l' || value === 'th'
}

/** Maps an IPA symbol back to a display name, for naming detected sounds. */
export function ipaToDisplay(ipa: string | null): string {
  if (!ipa) return '—'
  const known: Record<string, string> = {
    s: '/S/',
    ɹ: '/R/',
    r: '/R/',
    l: '/L/',
    θ: '/TH/',
    ð: '/TH/',
    ʃ: '/SH/',
    w: '/W/',
    f: '/F/',
    t: '/T/',
    d: '/D/',
    z: '/Z/',
    j: '/Y/',
    ʊ: '/OO/',
  }
  return known[ipa] ?? `/${ipa.toUpperCase()}/`
}
