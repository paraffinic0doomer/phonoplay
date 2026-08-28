/** Learner-facing safety and privacy wording. */

export const DISCLAIMER =
  'PhonoPlay provides educational pronunciation feedback and is not a medical diagnosis.'

export const UNCERTAIN = 'Unable to confidently assess this attempt.'

export const ANALYSIS_FAILED =
  "We couldn't confidently analyze this recording. Try again in a quieter environment."

export const PRIVACY_SUMMARY =
  'Recordings are analyzed and then discarded. PhonoPlay keeps measurements in this browser, never raw audio, and never asks for your name or other personal details.'

export interface HowItWorksStep {
  step: number
  title: string
  detail: string
}

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
      'A speech-to-text model reports which words it recognised. This is context, not a pronunciation score: it can correct mispronunciations toward real words, so it cannot tell you how a sound was produced.',
  },
  {
    step: 3,
    title: 'Acoustic features estimate pronunciation similarity',
    detail:
      'Measurements of sound energy, loudness, and duration are compared with reference recordings. The result is a similarity estimate, not a verdict.',
  },
  {
    step: 4,
    title: 'AI generates practice material',
    detail:
      'A language model writes the next exercise. It never sees your recording and never decides how you did: that comes from the acoustic measurement alone.',
  },
]

export interface AudioStage {
  label: string
  audioLeavesBrowser: boolean
  detail: string
}

/** Exact handling of audio. No stage persists a raw recording. */
export const AUDIO_HANDLING: AudioStage[] = [
  {
    label: 'Pronunciation analysis',
    audioLeavesBrowser: true,
    detail:
      'The recording is sent to the PhonoPlay analysis service, measured, and discarded when the request ends. Only derived measurements are saved in your browser.',
  },
  {
    label: 'Speech recognition',
    audioLeavesBrowser: true,
    detail:
      'The older speech-recognition flow sends audio to Groq, a third-party service, for a transcript. A transcript is context only, never a pronunciation score.',
  },
  {
    label: 'Practice material',
    audioLeavesBrowser: false,
    detail:
      'No audio is sent. The exercise generator receives only the target sound, practice stage, learning mode, and selected languages; it never receives a recording or a score.',
  },
]

export const NOT_CLAIMED = [
  'PhonoPlay does not diagnose, assess, or treat any speech, language, hearing, or developmental condition.',
  'Accessibility Mode is an alternative learning experience with smaller, calmer practice steps. It is not a medical mode or treatment.',
  'It cannot tell a pronunciation pattern apart from an accent, a regional variant, a head cold, or a poor microphone.',
  'Its reference recordings are two synthesised adult voices, so results may be less reliable outside that reference context.',
  'A result is about one recording of one sound. It is not evidence about a person.',
]
