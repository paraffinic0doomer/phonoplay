import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import { ERROR_COPY } from './errorCopy.ts'
import { CLIP_PROBLEM } from './recorder.ts'
import type { ClipProblem, RecorderErrorCode } from './recorder.ts'

/**
 * Every failure the learner can reach must have words attached.
 *
 * A code with no entry in ERROR_COPY renders as "Something went wrong", which
 * throws away the only useful thing about having a specific code. This caught
 * a real gap: renaming the client-side too-short code left it with no copy,
 * so a learner who tapped record and stopped instantly was told nothing about
 * what to do differently.
 */

/** Every code AudioRecorder can raise. Mirrors RecorderErrorCode. */
const RECORDER_CODES: RecorderErrorCode[] = [
  'MIC_UNSUPPORTED',
  'MIC_INSECURE_CONTEXT',
  'MIC_DENIED',
  'MIC_NOT_FOUND',
  'MIC_BUSY',
  'RECORDING_FAILED',
]

/** Codes the API can return that the recording flow surfaces directly. */
const API_CODES = [
  'UPLOAD_FAILED',
  'UPLOAD_TIMEOUT',
  'NETWORK_UNAVAILABLE',
  'UNSUPPORTED_AUDIO_FORMAT',
  'AUDIO_TOO_SHORT',
  'AUDIO_TOO_QUIET',
  'NO_SPEECH_DETECTED',
]

/**
 * Every code app/stt/errors.py can raise. Kept in sync by hand because the
 * backend is a separate process — the pairing is asserted here instead.
 */
const STT_CODES = [
  'STT_FAILED',
  'STT_NOT_CONFIGURED',
  'STT_AUTH_FAILED',
  'STT_RATE_LIMITED',
  'STT_TIMEOUT',
  'STT_UNAVAILABLE',
  'STT_INVALID_AUDIO',
  'STT_BAD_RESPONSE',
]

describe('speech-to-text failures', () => {
  it('covers every code the transcription stage can raise', () => {
    for (const code of STT_CODES) {
      assert.ok(ERROR_COPY[code], `no copy for STT code ${code}`)
    }
  })

  it('never implies a pronunciation result was produced or lost', () => {
    // Transcription is not assessment. Copy about a failed transcription must
    // not suggest the learner lost a score, or that one was ever computed
    // from the transcript.
    for (const code of STT_CODES) {
      const text = `${ERROR_COPY[code].title} ${ERROR_COPY[code].help}`
      assert.ok(
        !/\b(score|scored|rating|assessment|accuracy|pronunciation (was|could not be) )\b/i.test(
          text,
        ),
        `${code} implies a pronunciation result`,
      )
    }
  })

  it('says what the stage actually does', () => {
    // "Word recognition" rather than "analysis": the learner should be able to
    // tell which of the two stages failed.
    for (const code of STT_CODES) {
      const text = `${ERROR_COPY[code].title} ${ERROR_COPY[code].help}`
      assert.match(text, /word|speech-to-text|heard|said/i, code)
    }
  })
})

describe('error copy coverage', () => {
  it('covers every recorder failure', () => {
    for (const code of RECORDER_CODES) {
      assert.ok(ERROR_COPY[code], `no copy for recorder code ${code}`)
    }
  })

  it('covers every clip the client rejects', () => {
    const problems: ClipProblem[] = ['empty', 'too-short', 'silent', 'too-long']
    for (const problem of problems) {
      const { code } = CLIP_PROBLEM[problem]
      assert.ok(ERROR_COPY[code], `no copy for clip problem "${problem}" (${code})`)
    }
  })

  it('covers the upload and analysis failures', () => {
    for (const code of API_CODES) {
      assert.ok(ERROR_COPY[code], `no copy for API code ${code}`)
    }
  })
})

describe('what the copy says', () => {
  const entries = Object.entries(ERROR_COPY)

  it('gives every error a way forward', () => {
    for (const [code, copy] of entries) {
      assert.match(
        copy.help,
        /try|check|move|open|close|plug|say|tap|hold|give it|practise|send|keep|carry on|continue|record/i,
        `${code} does not tell the learner what to do`,
      )
    }
  })

  it('never leaks internals into the learner-facing text', () => {
    for (const [code, copy] of entries) {
      const text = `${copy.title} ${copy.help}`
      assert.ok(
        !/\b(null|undefined|exception|stack|traceback|http \d|[45]\d\d error)\b/i.test(text),
        `${code} leaks implementation detail`,
      )
    }
  })

  it('never blames the learner', () => {
    for (const [code, copy] of entries) {
      const text = `${copy.title} ${copy.help}`
      assert.ok(!/\byou (failed|messed|did it wrong)\b/i.test(text), code)
    }
  })

  it('never claims a diagnosis or uses clinical language', () => {
    for (const [code, copy] of entries) {
      const text = `${copy.title} ${copy.help}`.toLowerCase()
      for (const term of ['dyslexia', 'disorder', 'diagnos', 'impair', 'therapy']) {
        assert.ok(!text.includes(term), `${code} uses "${term}"`)
      }
    }
  })

  it('keeps titles short enough to read at a glance', () => {
    for (const [code, copy] of entries) {
      assert.ok(copy.title.length <= 48, `${code} title is ${copy.title.length} chars`)
    }
  })
})
