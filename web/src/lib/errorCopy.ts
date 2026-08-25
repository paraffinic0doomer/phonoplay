/**
 * Plain-language copy for every error code the app can produce.
 *
 * Data, not markup, so it can be checked against the codes the recorder and
 * the API actually emit. A code with no entry here falls through to a generic
 * "Something went wrong", which is exactly what a learner does not need: the
 * whole point of a specific code is a specific next step.
 */
export interface ErrorCopy {
  title: string
  help: string
}

export const ERROR_COPY: Record<string, ErrorCopy> = {
  MIC_DENIED: {
    title: 'The microphone is blocked',
    help: 'Your browser is refusing microphone access. Open the padlock icon in the address bar, allow the microphone, then try again.',
  },
  MIC_NOT_FOUND: {
    title: 'No microphone found',
    help: 'We could not find a microphone on this device. Plug one in or check your system sound settings, then try again.',
  },
  MIC_BUSY: {
    title: 'The microphone is busy',
    help: 'Another app is using the microphone. Close it — video calls are the usual culprit — and try again.',
  },
  MIC_UNSUPPORTED: {
    title: 'This browser cannot record',
    help: 'Audio recording is not available here. Try Chrome, Edge, Firefox, or Safari.',
  },
  MIC_INSECURE_CONTEXT: {
    title: 'Recording needs a secure connection',
    help: 'Browsers only allow microphone access over https, or on localhost. Open PhonoPlay on a secure address and try again.',
  },
  MIC_UNAVAILABLE: {
    title: 'No microphone found',
    help: 'This browser cannot record audio. Try Chrome, Edge, or Firefox on a device with a microphone.',
  },
  RECORDING_FAILED: {
    title: 'The recording stopped',
    help: 'Something interrupted the recording — often the microphone being unplugged. Try once more.',
  },
  RECORDING_EMPTY: {
    title: 'Nothing was recorded',
    help: 'That recording came out empty. Hold on a moment longer, say the word, then stop.',
  },
  RECORDING_SILENT: {
    title: 'We could not hear anything',
    help: 'The recording is nearly silent. Check that the right microphone is selected, move closer, and say the word again.',
  },
  // Distinct from AUDIO_TOO_SHORT below: this one is the browser rejecting a
  // clip before anything is sent, usually a tap that stopped instantly.
  RECORDING_TOO_SHORT: {
    title: 'That was too short to hear',
    help: 'The recording stopped almost immediately. Tap to start, say the word, then tap again to stop.',
  },
  RECORDING_TOO_LONG: {
    title: 'That recording ran long',
    help: 'Recording stops automatically after eight seconds. Say just the word or phrase on its own, then stop.',
  },
  UPLOAD_FAILED: {
    title: 'The upload did not go through',
    help: 'Your recording is still here. Check your connection and send it again.',
  },
  UPLOAD_TIMEOUT: {
    title: 'The upload timed out',
    help: 'Your recording is still here — the network was too slow. Try sending it again.',
  },
  UNSUPPORTED_AUDIO_FORMAT: {
    title: 'That audio format was rejected',
    help: 'The service could not read the recording your browser produced. Try a different browser.',
  },
  AUDIO_TOO_SHORT: {
    title: 'That was a little short',
    help: 'Hold the button and say the whole word, then release.',
  },
  AUDIO_TOO_QUIET: {
    title: 'That was very quiet',
    help: 'Move closer to the microphone and say the word again at a normal volume.',
  },
  AUDIO_CLIPPED: {
    title: 'That was very loud',
    help: 'Move back from the microphone a little and try again.',
  },
  NO_SPEECH_DETECTED: {
    title: 'No speech detected',
    help: 'We could not hear a word in that recording. Try once more.',
  },
  ALIGNMENT_FAILED: {
    title: 'That one did not line up',
    help: 'The recording could not be matched to the word. Try saying just the word on its own.',
  },
  MODEL_NOT_READY: {
    title: 'The sound lab is still warming up',
    help: 'The analysis models are loading. Give it a few seconds and try again.',
  },
  /*
   * Speech-to-text failures.
   *
   * These describe the transcription stage only — working out which words
   * were said. None of them means anything about how a sound was produced,
   * so none of the copy below implies a pronunciation result was lost.
   *
   * Not currently reachable from the practice flow: `transcribe()` in
   * lib/api.ts resolves to null on every failure, so the "what we heard"
   * panel is omitted rather than replaced with an error. These entries exist
   * because ApiErrorCode declares the codes as part of the wire contract —
   * anything that does surface one should not fall through to "Something
   * went wrong". Deliberately cheap insurance, not a live code path.
   */
  STT_NOT_CONFIGURED: {
    title: 'Word recognition is switched off',
    help: 'This PhonoPlay server has no speech-to-text service configured, so you will not see the words that were heard. Keep recording as usual — your pronunciation feedback is unaffected.',
  },
  STT_AUTH_FAILED: {
    title: 'Word recognition is unavailable',
    help: 'The speech-to-text service rejected this server. Nothing is wrong with your recording — try again later.',
  },
  STT_RATE_LIMITED: {
    title: 'Word recognition is busy',
    help: 'The speech-to-text service is at capacity. Give it a moment and try again.',
  },
  STT_TIMEOUT: {
    title: 'Word recognition took too long',
    help: 'The speech-to-text service did not answer in time. Try again — a shorter recording usually helps.',
  },
  STT_UNAVAILABLE: {
    title: 'Cannot reach word recognition',
    help: 'The speech-to-text service is not responding. Try again in a moment.',
  },
  STT_INVALID_AUDIO: {
    title: 'That recording could not be read',
    help: 'The speech-to-text service could not read the audio. Record it again, a little longer.',
  },
  STT_BAD_RESPONSE: {
    title: 'Word recognition returned something unusable',
    help: 'The speech-to-text service answered in a way we could not read. Try again.',
  },
  STT_FAILED: {
    title: 'Word recognition did not finish',
    help: 'We could not work out which words were said. Try recording once more.',
  },
  NETWORK_UNAVAILABLE: {
    title: 'Cannot reach the analysis service',
    help: 'The API is not responding. Check that the backend is running, then try again.',
  },
  LLM_UNAVAILABLE: {
    title: 'Could not build a new challenge',
    help: 'Your score is still valid. You can practise the same word again.',
  },
}
