import { LanguageKnowledgeService } from '../language/index.ts'
import type { Phoneme } from '../db/index.ts'

/**
 * The baseline assessment: what the learner is asked to do, in what order.
 *
 * Every prompt targets a specific sound at the start of the word. That is not
 * a stylistic choice — `app/acoustic/` locates the target at the onset of the
 * utterance, and its reference profiles are built from word-initial tokens.
 * Asking for a sound the analyser cannot reliably find would produce a number
 * with nothing behind it.
 *
 * ── On stress and rhythm ─────────────────────────────────────────────────
 *
 * The brief asks for basic stress and rhythm "where technically feasible".
 * It is not, yet, and this file deliberately contains no stress task.
 *
 * Measured before deciding: eight two-syllable words with unambiguous stress
 * (RAB-bit, TA-ble, WA-ter, PA-per against a-BOUT, be-LOW, a-GO, sur-PRISE),
 * synthesised in both reference voices, run through syllable-nucleus
 * detection on the voiced energy envelope and scored on peak prominence times
 * nucleus duration. Four of the sixteen tokens produced no clean two-nucleus
 * split at all; of the twelve that did, ten were labelled correctly. Ten of
 * sixteen on a binary task is barely above the fifty percent a coin gets,
 * and that was clean synthetic speech, in-sample, with a hand-tuned detector.
 *
 * A stress score built on that would be indistinguishable from a guess, and
 * the one rule this product cannot break is inventing a measurement. The
 * sounds below are measured because the analyser can measure them; stress is
 * absent because it cannot. See acoustic/reference/README.md for what a real
 * measurement has to survive before it earns a percentage.
 */

/** The six task shapes. Only some of them produce a measurement. */
export type TaskKind =
  | 'listen'
  | 'repeat-sound'
  | 'word'
  | 'minimal-pair'
  | 'phrase'
  | 'sentence'

export interface Task {
  id: string
  kind: TaskKind
  phoneme: Phoneme
  /** What the learner says, or hears. */
  text: string
  /** The near-identical word, for contrast tasks. Never the target. */
  contrast?: string
  /** One line telling the learner what to do. */
  instruction: string
  /**
   * Whether this task's recording feeds the pronunciation profile.
   *
   * `listen` and `minimal-pair` are perception, not production. `repeat-sound`
   * is production but is NOT measured: a sound said on its own has no
   * following vowel, and /r/ and /l/ are identified by their formant
   * transitions into one. Scoring an isolated approximant would be measuring
   * something the reference profiles were never built from.
   */
  measured: boolean
}

/** The four sounds the profile reports on. */
export const ASSESSED_PHONEMES: Phoneme[] = ['s', 'r', 'l', 'th']

/** How the sound is written for the learner. */
export const PHONEME_LABEL: Record<Phoneme, string> = {
  s: '/S/',
  r: '/R/',
  l: '/L/',
  th: '/TH/',
}

/** Plain-language name, for instructions and screen readers. */
export const PHONEME_NAME: Record<Phoneme, string> = {
  s: 'the S sound',
  r: 'the R sound',
  l: 'the L sound',
  th: 'the TH sound',
}

function wordTasks(): Task[] {
  // Straight from the knowledge layer rather than a list typed out here, so
  // the words the assessment uses and the words the language model documents
  // as assessable cannot drift apart.
  return LanguageKnowledgeService.getAssessmentPrompts({ native: 'en' })
    .filter((prompt) => (ASSESSED_PHONEMES as string[]).includes(prompt.phoneme))
    .map((prompt, index) => ({
      id: `word-${prompt.phoneme}-${index}`,
      kind: 'word' as const,
      phoneme: prompt.phoneme as Phoneme,
      text: prompt.text,
      contrast: prompt.contrast,
      instruction: prompt.instruction,
      measured: true,
    }))
}

/**
 * Standard mode: one word at a time, each one measured.
 *
 * Two words per sound. One measurement is a single reading of a single
 * recording; two is enough to notice that a learner is consistent, or that
 * they are not, without turning a first sitting into a test.
 */
export function standardPlan(): Task[] {
  return wordTasks()
}

/**
 * Connected speech, said last.
 *
 * The target sits at the very start of the utterance in both, because that is
 * where the analyser looks. These measure the same sound in a longer breath
 * group — not rhythm, which is not measured at all.
 */
const CONNECTED: Task[] = [
  {
    id: 'phrase-s',
    kind: 'phrase',
    phoneme: 's',
    text: 'Seven silver spoons',
    instruction: 'Say the whole phrase once, at a comfortable pace.',
    measured: true,
  },
  {
    id: 'sentence-th',
    kind: 'sentence',
    phoneme: 'th',
    text: 'Thank you for the three books.',
    instruction: 'Say the whole sentence once, as you normally would.',
    measured: true,
  },
]

/**
 * Accessibility Mode: the same measurements, reached in smaller steps.
 *
 * Nothing here is easier and nothing is worth less — the words that feed the
 * profile are the same words Standard Mode uses, so the two produce a
 * comparable profile. What changes is the approach to each one: the sound is
 * heard before it is said, said on its own before it is said in a word, and
 * the pair it is most often confused with is heard side by side.
 *
 * One task is on screen at a time in both modes. Here there are simply more
 * of them, each smaller.
 */
export function accessibilityPlan(): Task[] {
  const words = wordTasks()
  const tasks: Task[] = []

  for (const phoneme of ASSESSED_PHONEMES) {
    const forPhoneme = words.filter((task) => task.phoneme === phoneme)
    if (forPhoneme.length === 0) continue

    // 1. Hear it.
    tasks.push({
      id: `listen-${phoneme}`,
      kind: 'listen',
      phoneme,
      text: forPhoneme[0].text,
      instruction: `Listen to ${PHONEME_NAME[phoneme]}. Nothing to record yet.`,
      measured: false,
    })

    // 2. Say it on its own. Practice — see `measured` on the Task type.
    tasks.push({
      id: `repeat-${phoneme}`,
      kind: 'repeat-sound',
      phoneme,
      text: PHONEME_LABEL[phoneme],
      instruction: 'Say just the sound, on its own. This one is practice.',
      measured: false,
    })

    // 3. Say it in a word. Measured.
    tasks.push(...forPhoneme)

    // 4. Tell it apart from the sound it is most often swapped with.
    const pair = forPhoneme.find((task) => task.contrast)
    if (pair?.contrast) {
      tasks.push({
        id: `pair-${phoneme}`,
        kind: 'minimal-pair',
        phoneme,
        text: pair.text,
        contrast: pair.contrast,
        instruction: 'Listen to both, then choose the one you were asked for.',
        measured: false,
      })
    }
  }

  return [...tasks, ...CONNECTED]
}

export function planFor(mode: 'standard' | 'accessibility'): Task[] {
  return mode === 'accessibility' ? accessibilityPlan() : standardPlan()
}

/** How many tasks in this plan actually produce a measurement. */
export function measuredCount(plan: Task[]): number {
  return plan.filter((task) => task.measured).length
}
