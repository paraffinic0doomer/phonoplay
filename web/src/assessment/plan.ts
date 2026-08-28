import { LanguageKnowledgeService } from '../language/index.ts'
import type { Phoneme } from '../db/index.ts'
import type { LanguageCode } from '../language/index.ts'

/**
 * The baseline assessment plan. Every measured prompt starts with its target
 * sound because the acoustic analyser locates the target at utterance onset.
 * We deliberately do not score stress or rhythm until the analyser can
 * produce evidence robust enough to support those claims.
 */
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
  text: string
  contrast?: string
  instruction: string
  measured: boolean
}

export const ASSESSED_PHONEMES: Phoneme[] = ['s', 'r', 'l', 'th']

export const PHONEME_LABEL: Record<Phoneme, string> = {
  s: '/S/',
  r: '/R/',
  l: '/L/',
  th: '/TH/',
}

export const PHONEME_NAME: Record<Phoneme, string> = {
  s: 'the S sound',
  r: 'the R sound',
  l: 'the L sound',
  th: 'the TH sound',
}

function wordTasks(options: { native?: string; target?: string } = {}): Task[] {
  // The language knowledge layer owns the supported, word-initial prompts.
  return LanguageKnowledgeService.getAssessmentPrompts({
    native: options.native as LanguageCode | undefined,
    target: options.target as LanguageCode | undefined,
  })
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

/** Standard Mode takes two real readings per target sound. */
export function standardPlan(options?: { native?: string; target?: string }): Task[] {
  return wordTasks(options)
}

/**
 * Accessibility Mode takes a short, predictable real-audio baseline: one
 * validated word for each target sound. It keeps the first sitting calm; the
 * personalised practice ladder supplies listening, isolation, and minimal
 * pairs only after this evidence identifies the next small step.
 */
export function accessibilityPlan(options?: { native?: string; target?: string }): Task[] {
  const words = wordTasks(options)
  return ASSESSED_PHONEMES.flatMap((phoneme) =>
    words.filter((task) => task.phoneme === phoneme).slice(0, 1),
  )
}

export function planFor(
  mode: 'standard' | 'accessibility',
  options?: { native?: string; target?: string },
): Task[] {
  return mode === 'accessibility' ? accessibilityPlan(options) : standardPlan(options)
}

export function measuredCount(plan: Task[]): number {
  return plan.filter((task) => task.measured).length
}
