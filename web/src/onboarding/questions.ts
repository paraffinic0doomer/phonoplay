import { LanguageKnowledgeService } from '../language/index.ts'
import type { LearningMode, SelfLevel } from '../db/index.ts'

/**
 * The onboarding questions.
 *
 * Content lives here rather than inside the component so the flow can be read
 * in one place and the copy reviewed without opening JSX. Language options
 * come from `LanguageKnowledgeService` rather than a list typed out here —
 * adding a language should not mean editing a screen.
 */

/** Sentinel for "my language is not listed". Never a stored value. */
export const OTHER = '__other__'

export interface Choice<T extends string = string> {
  value: T
  /** The main line. Large type; keep it short. */
  label: string
  /** In the language's own script, where that differs from the label. */
  nativeLabel?: string
  /** One line under the label. */
  detail?: string
}

/** Why someone is learning. Stored on `settings.learningGoal`. */
export type LearningGoal =
  | 'conversation'
  | 'academic'
  | 'professional'
  | 'travel'
  | 'general'

export const STEP_COUNT = 5

/**
 * First-language options, built from the knowledge layer.
 *
 * "Other" is appended rather than stored as a language: a learner who picks
 * it types their own, and that text is saved as-is. Every lookup then misses
 * and they get the plain English ordering — which is the designed outcome,
 * not a failure. Inventing a bridge for a language nobody has researched
 * would be worse than having none.
 */
export function nativeLanguageChoices(): Choice[] {
  const known = LanguageKnowledgeService.getSupportedLanguages()
    // Bangla first: it is the pairing PhonoPlay has actually researched, and
    // the one the product is built around.
    .sort((a, b) => (a.code === 'bn' ? -1 : b.code === 'bn' ? 1 : a.name.localeCompare(b.name)))
    .map<Choice>((language) => ({
      value: language.code,
      label: language.name,
      nativeLabel: language.nativeName !== language.name ? language.nativeName : undefined,
    }))

  return [
    ...known,
    {
      value: OTHER,
      label: 'Other',
      detail: 'Tell us which one — practice still works.',
    },
  ]
}

/**
 * Target-language options.
 *
 * Only languages with acoustic reference data appear, so the flow never
 * offers a target PhonoPlay cannot measure.
 */
export function targetLanguageChoices(): Choice[] {
  return LanguageKnowledgeService.getTargetLanguages().map<Choice>((language) => ({
    value: language.code,
    label: language.name,
    detail: 'The only language PhonoPlay measures today.',
  }))
}

/** Self-reported. Used to set a starting point, never to lock content away. */
export const LEVEL_CHOICES: Choice<SelfLevel>[] = [
  {
    value: 'beginner',
    label: 'Beginner',
    detail: 'Still finding my footing with English sounds.',
  },
  {
    value: 'intermediate',
    label: 'Intermediate',
    detail: 'Comfortable talking, working on specific sounds.',
  },
  {
    value: 'advanced',
    label: 'Advanced',
    detail: 'Fluent, polishing the last few details.',
  },
]

export const GOAL_CHOICES: Choice<LearningGoal>[] = [
  { value: 'conversation', label: 'Conversation', detail: 'Everyday talking with people.' },
  { value: 'academic', label: 'Academic', detail: 'Study, lectures, presentations.' },
  { value: 'professional', label: 'Professional', detail: 'Work, meetings, interviews.' },
  { value: 'travel', label: 'Travel', detail: 'Getting around and being understood.' },
  { value: 'general', label: 'General improvement', detail: 'Just want to sound clearer.' },
]

/**
 * Learning mode.
 *
 * Accessibility Mode is offered as a way of working, chosen by the learner.
 * Nothing here asks about, records, or infers anything medical — no
 * condition is named, no disclosure is requested, and the mode can be
 * switched at any time from settings.
 */
export const MODE_CHOICES: Choice<LearningMode>[] = [
  {
    value: 'standard',
    label: 'Standard',
    detail: 'Adaptive pronunciation practice.',
  },
  {
    value: 'accessibility',
    label: 'Accessibility Mode',
    detail: 'Smaller steps, extra sound practice, and more repetition.',
  },
]

/** Shown under the mode question. Describes the mode, never the learner. */
export const MODE_NOTE =
  'Accessibility Mode may be useful for learners who benefit from additional ' +
  'phonological practice. You can switch between modes at any time.'

/** The questions, in order. Titles are the large type on each screen. */
export const STEP_TITLES = [
  'What is your first language?',
  'What language do you want to practice?',
  'How comfortable are you?',
  'Why are you learning?',
  'How would you like to learn?',
] as const
