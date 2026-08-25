import type { Phoneme } from '../db'
import { PHONEME_LABEL } from './material'

/**
 * What the learner is told after an attempt.
 *
 * Two rules govern every string in this file, and they are not stylistic.
 *
 * **Nothing here is a failure.** There is no "wrong", no "incorrect", no
 * "failed", and no score presented as a pass mark. A recording that measured
 * badly is a recording, and the reply to it is what to try next. CLAUDE.md
 * rules out punitive failure; this is where that rule either holds or does
 * not.
 *
 * **Nothing here is about the learner.** The subject of every sentence is the
 * recording or the sound, never the person. "That one came out closer to /L/"
 * describes audio. "You have trouble with /R/" would be a claim about someone
 * that no measurement supports.
 *
 * The wording is short on purpose. A paragraph after every attempt is a
 * paragraph nobody reads by the fourth repetition.
 */

/** Above this the attempt matched the target well. */
export const ON_TARGET = 0.75
/** Above this it is recognisably the right sound, not yet clean. */
export const CLOSE = 0.5

export interface AttemptFeedback {
  /** The headline. Short. */
  headline: string
  /** One line of what to do next, or what changed. */
  detail: string
  /** Tone, for styling only. Never rendered as a word. */
  tone: 'good' | 'close' | 'keep-going' | 'unmeasured'
}

/**
 * Turn one measured attempt into something worth reading.
 *
 * `previous` is the last similarity for this sound, when there is one. Being
 * able to say "closer than last time" is the single most useful thing this
 * function does, and it is only possible because the learner model keeps the
 * history.
 */
export function feedbackFor(input: {
  phoneme: Phoneme
  similarity: number | null
  assessed: boolean
  /** What the analyser thought it heard, when it named something. */
  detected: Phoneme | string | null
  previous: number | null
}): AttemptFeedback {
  const target = PHONEME_LABEL[input.phoneme]

  // The analyser declined to score it. Not a bad attempt — no attempt was
  // measured at all, and saying otherwise would invent a result.
  if (!input.assessed || input.similarity === null) {
    return {
      headline: 'Let’s try again.',
      detail:
        'That recording was not clear enough to measure. Somewhere quieter, or a little closer to the microphone, usually does it.',
      tone: 'unmeasured',
    }
  }

  const improved =
    input.previous !== null && input.similarity > input.previous + 0.02

  if (input.similarity >= ON_TARGET) {
    return {
      headline: 'That one landed.',
      detail: improved
        ? `Closer than last time, and well inside ${target}.`
        : `That measured like ${target}.`,
      tone: 'good',
    }
  }

  if (input.similarity >= CLOSE) {
    return {
      headline: 'Getting closer.',
      detail: improved
        ? 'Better than the last one. Same again.'
        : `That is recognisably ${target} — a little more of it and you are there.`,
      tone: 'close',
    }
  }

  // Below CLOSE. Still not a failure: say what was measured and what to do.
  const named =
    input.detected && input.detected !== input.phoneme
      ? `That one came out closer to ${PHONEME_LABEL[input.detected as Phoneme] ?? `/${String(input.detected).toUpperCase()}/`}.`
      : `That one did not measure much like ${target} yet.`

  return {
    headline: improved ? 'Getting closer.' : 'Let’s try again.',
    detail: improved ? `${named} Still, better than the last one.` : named,
    tone: 'keep-going',
  }
}

/**
 * What to say when the learner model says they are ready to move up.
 *
 * An invitation, never an automatic jump: the learner decides when to leave a
 * rung they are comfortable on. Accessibility Mode in particular is built
 * around being allowed to stay.
 */
export function readyToAdvance(nextStageLabel: string): AttemptFeedback {
  return {
    headline: 'Ready for the next step?',
    detail: `${nextStageLabel} is unlocked whenever you want it. Staying here is fine too.`,
    tone: 'good',
  }
}

/**
 * What to say to someone who has been on one rung a long time.
 *
 * Offered as help, not as a verdict. Nothing is taken away and no stage is
 * closed — the only thing that changes is that an easier route is mentioned.
 */
export function supportOffer(): AttemptFeedback {
  return {
    headline: 'This one is taking a while — that is normal.',
    detail:
      'Some sounds take many goes. You can keep practising here, or try the same sound in a shorter form.',
    tone: 'keep-going',
  }
}

/** The line above the day's work. */
export function missionLine(phoneme: Phoneme, stageLabel: string): string {
  return `${PHONEME_LABEL[phoneme]} at ${stageLabel.toLowerCase()} level`
}
