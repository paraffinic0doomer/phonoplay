/**
 * The sentences PhonoPlay promises to say.
 *
 * Mirrors `api/app/safety.py`, which is where the backend's copies live and
 * where they are asserted exactly. They are duplicated here rather than
 * fetched because they must render even when the API is unreachable — a
 * disclaimer that disappears when the network does is not a disclaimer. The
 * browser suite asserts the rendered strings, so the two cannot drift far.
 *
 * Change one, change the other, in the same commit.
 */

/** Shown wherever a result appears. */
export const DISCLAIMER =
  'PhonoPlay provides educational pronunciation feedback and is not a medical diagnosis.'

/** Shown when confidence falls below the floor. */
export const UNCERTAIN = 'Unable to confidently assess this attempt.'

/** Shown when the analysis could not run at all. */
export const ANALYSIS_FAILED =
  "We couldn't confidently analyze this recording. Try again in a quieter environment."

export const PRIVACY_SUMMARY =
  'Recordings are analyzed and then discarded. PhonoPlay keeps the measurements, never the audio, and never asks for your name or any other personal detail.'

export interface HowItWorksStep {
  step: number
  title: string
  detail: string
}

/**
 * The four steps behind a result.
 *
 * Step 2 is the one worth reading twice: speech recognition is context, not a
 * score. It is listed because it happens, not because it measures how a sound
 * was made.
 */
export const HOW_IT_WORKS: HowItWorksStep[] = [
  {
    step: 1,
    title: 'Audio is analyzed',
    detail:
      'Your recording is measured for loudness, noise, and where the target sound sits in it. If it cannot support a result, PhonoPlay stops here and says so.',
  },
  {
    step: 2,
    title: 'Speech recognition provides linguistic context',
    detail:
      'A speech-to-text model reports which words it recognised. This is context, not a pronunciation score — it corrects mispronunciations toward real words, so it cannot tell you how a sound was produced.',
  },
  {
    step: 3,
    title: 'Acoustic features help estimate pronunciation similarity',
    detail:
      "Measurements from the recording — where the sound's energy sits, how loud and how long it is, where the tongue shaped it — are compared against reference recordings. The result is a similarity estimate, not a verdict.",
  },
  {
    step: 4,
    title: 'AI generates practice material',
    detail:
      'A language model writes the next exercise. It never sees your recording and never decides how you did — that comes from the measurement alone.',
  },
]

export interface AudioStage {
  label: string
  leavesDevice: boolean
  detail: string
}

/**
 * Where audio goes, per stage.
 *
 * Listed separately because the answers genuinely differ, and the honest
 * version has to include the uncomfortable one: transcription sends the
 * recording to a third party.
 */
export const AUDIO_HANDLING: AudioStage[] = [
  {
    label: 'Pronunciation analysis',
    leavesDevice: false,
    detail:
      'Runs on the PhonoPlay server. The recording is measured, the numbers are kept, and the audio is discarded when the request ends.',
  },
  {
    label: 'Speech recognition',
    leavesDevice: true,
    detail:
      'The recording is sent to Groq, a third-party speech-to-text service, to work out which words were said. This is the only step that sends audio anywhere.',
  },
  {
    label: 'Practice material',
    leavesDevice: false,
    detail:
      'The exercise generator receives text only — the target sound, the stage, and the language being practised. It never receives a recording or a score.',
  },
]

/** Stated plainly, so the UI never has to paraphrase a limit. */
export const NOT_CLAIMED = [
  'PhonoPlay does not diagnose, assess, or treat any speech, language, hearing, or developmental condition.',
  'It cannot tell a pronunciation pattern apart from an accent, a regional variant, a head cold, or a poor microphone.',
  'Its reference recordings are two synthesised adult voices, so it is least reliable for the children it is designed to help.',
  'A result is about one recording of one sound. It is not evidence about a person.',
]
