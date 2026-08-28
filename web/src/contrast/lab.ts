import { isMeasured, measurableSide } from './pairs.ts'
import type { Contrast, ContrastSide, LabStep, MinimalPair } from './pairs.ts'

/**
 * What the lab asks for at each step, and what it says back.
 *
 * Pure. Every function here takes what it needs and returns what to show, so
 * the wording — the part that has to stay non-punitive under every outcome —
 * can be read and tested without a browser.
 */

/* ── Choosing what to present ─────────────────────────────────────── */

/**
 * One discrimination trial: a word to play, and which side it carries.
 *
 * `index` walks the pair list and the alternation together rather than
 * drawing at random, so a run is reproducible and every word is used before
 * any is repeated. A learner who happens to get four of the same side in a
 * row learns the pattern instead of the sound.
 */
export interface Trial {
  /** The word that plays. */
  word: string
  /** Which side of the pair it carries — the correct answer. */
  answer: 'a' | 'b'
  /** Both words, for showing the pair after the answer. */
  pair: MinimalPair
}

export function trialAt(contrast: Contrast, index: number): Trial {
  const pair = contrast.words[index % contrast.words.length]
  // Alternate sides on a different cycle from the words, so neither the word
  // nor the side is predictable from the other.
  const answer = Math.floor(index / contrast.words.length) % 2 === 0
    ? (index % 2 === 0 ? 'a' : 'b')
    : (index % 2 === 0 ? 'b' : 'a')
  return { word: answer === 'a' ? pair.a : pair.b, answer, pair }
}

/** What the learner says at a production step, and the sound it targets. */
export interface SpokenTask {
  text: string
  side: ContrastSide
  /** False for `repeat`, which is practice only. */
  measured: boolean
}

/**
 * The spoken task for a step.
 *
 * Always built around the side that has a measurable target. Asking for the
 * unmeasurable half — "say tin" when /t/ is not a practice target — would
 * produce a recording with nothing to score it against.
 */
export function spokenTask(
  contrast: Contrast,
  step: LabStep,
  index = 0,
): SpokenTask | null {
  const side = measurableSide(contrast)
  if (!side) return null

  const first = contrast.a.target === side.target ? 'a' : 'b'
  const pair = contrast.words[index % contrast.words.length]

  switch (step) {
    case 'repeat':
      return { text: side.label, side, measured: false }
    case 'minimal_pair':
    case 'word':
      return { text: first === 'a' ? pair.a : pair.b, side, measured: true }
    case 'phrase':
      return { text: contrast.phrase, side, measured: true }
    case 'sentence':
      return { text: contrast.sentence, side, measured: true }
    default:
      return null
  }
}

/* ── What the lab says ────────────────────────────────────────────── */

export interface LabMessage {
  headline: string
  detail: string
  /** Styling only. Never rendered as a word. */
  tone: 'good' | 'keep-going' | 'unmeasured'
}

/**
 * Discrimination feedback.
 *
 * A wrong answer is an invitation to listen again, never a verdict. There is
 * no "wrong", no "incorrect", and no score shown at the moment of answering —
 * the running accuracy belongs on the summary, not in the learner's face
 * immediately after a mistake.
 */
export function discriminationFeedback(
  correct: boolean,
  heard: ContrastSide,
): LabMessage {
  if (correct) {
    return {
      headline: 'Great — you identified the target sound.',
      detail: `That was ${heard.name}.`,
      tone: 'good',
    }
  }
  return {
    headline: 'Let’s hear the difference once more.',
    detail: `That one was ${heard.name}. Play them both again and listen for what changes.`,
    tone: 'keep-going',
  }
}

/**
 * Production feedback.
 *
 * When the analyser names the *other* half of the pair, that is the finding
 * this lab exists to surface, and it is worth saying directly — followed by
 * what to do about it, which is always to go back to the sound on its own.
 */
export function productionFeedback(input: {
  contrast: Contrast
  side: ContrastSide
  similarity: number | null
  detected: string | null
  assessed: boolean
}): LabMessage {
  const { contrast, side, similarity, detected, assessed } = input
  const other = contrast.a.label === side.label ? contrast.b : contrast.a

  if (!assessed || similarity === null) {
    return {
      headline: 'Let’s try again.',
      detail:
        'That recording could not be measured — often the room rather than the speaking. Move a little closer and say it once more.',
      tone: 'unmeasured',
    }
  }

  // The contrast showed up: measured as the sound on the other side.
  if (detected && detected.toLowerCase() === (other.target ?? other.label.toLowerCase())) {
    return {
      headline: `Let’s isolate the ${side.label} sound.`,
      detail: `That measured closer to ${other.name} than to ${side.name}. ${contrast.difference}`,
      tone: 'keep-going',
    }
  }

  if (similarity >= 0.75) {
    return {
      headline: 'Great — that measured like the target sound.',
      detail: `Clear ${side.name}. Ready for the next step?`,
      tone: 'good',
    }
  }

  if (similarity >= 0.5) {
    return {
      headline: 'Getting closer.',
      detail: `Recognisably ${side.name}, not quite clean yet. One more?`,
      tone: 'keep-going',
    }
  }

  return {
    headline: 'Let’s try again.',
    detail: `${contrast.difference} Take it slowly.`,
    tone: 'keep-going',
  }
}

/** Shown when a step is finished and the next one is available. */
export function readyForNext(nextLabel: string): LabMessage {
  return {
    headline: 'Ready for the next step?',
    detail: `Next up: ${nextLabel.toLowerCase()}.`,
    tone: 'good',
  }
}

/* ── Accuracy ─────────────────────────────────────────────────────── */

/**
 * Running accuracy over the trials answered so far.
 *
 * Null rather than zero before anything is answered: nought percent and "not
 * yet attempted" are different things, and a learner opening the lab should
 * not be greeted by a zero.
 */
export function accuracy(correct: number, attempts: number): number | null {
  if (attempts === 0) return null
  return Math.round((correct / attempts) * 100)
}

/**
 * Enough answers for the accuracy to mean anything.
 *
 * With two options a single correct answer is a coin landing heads, and three
 * is the fewest that can show a pattern rather than luck.
 */
export const MEANINGFUL_TRIALS = 3

export function accuracyIsMeaningful(attempts: number): boolean {
  return attempts >= MEANINGFUL_TRIALS
}

export { isMeasured }
