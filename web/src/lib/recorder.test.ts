import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import {
  CLIP_PROBLEM,
  MAX_CLIP_MS,
  MIN_CLIP_S,
  SILENCE_PEAK_THRESHOLD,
  detectSupport,
  pickFormat,
  validateClip,
} from './recorder.ts'
import type { ClipProblem, RecordingClip } from './recorder.ts'

/**
 * The parts of capture that are pure, tested without a browser.
 *
 * The device half needs MediaRecorder and is covered by the browser harness.
 * What is testable here is the gate that decides whether a recording ever
 * reaches the network, and the words the learner is shown when it does not.
 */

/** A clip that passes every check, to vary one field at a time. */
function clip(overrides: Partial<RecordingClip> = {}): RecordingClip {
  return {
    blob: new Blob([new Uint8Array(8192)], { type: 'audio/webm' }),
    mimeType: 'audio/webm;codecs=opus',
    extension: 'webm',
    durationS: 1.4,
    sampleRate: 48000,
    channels: 1,
    sizeBytes: 8192,
    peak: 0.6,
    rms: 0.18,
    peaks: [],
    ...overrides,
  }
}

describe('validateClip', () => {
  it('accepts an ordinary spoken word', () => {
    assert.equal(validateClip(clip()), null)
  })

  it('accepts a clip anywhere in the 2-8 second range', () => {
    for (const durationS of [2, 3.5, 5, 7.9]) {
      assert.equal(validateClip(clip({ durationS })), null, `${durationS}s`)
    }
  })

  it('accepts a single short word', () => {
    // "sun" is well under a second. A 2s floor would reject the product's
    // own word-level practice, so the floor is only there to catch a click
    // that captured nothing.
    assert.equal(validateClip(clip({ durationS: 0.5 })), null)
  })

  it('rejects a failed encode as empty, not as too short', () => {
    assert.equal(validateClip(clip({ sizeBytes: 300 })), 'empty')
    assert.equal(validateClip(clip({ durationS: 0 })), 'empty')
  })

  it('rejects a clip below the floor', () => {
    assert.equal(validateClip(clip({ durationS: MIN_CLIP_S - 0.01 })), 'too-short')
  })

  it('rejects silence, however long', () => {
    assert.equal(
      validateClip(clip({ peak: SILENCE_PEAK_THRESHOLD - 0.001, durationS: 5 })),
      'silent',
    )
  })

  it('rejects a clip that overran the cap', () => {
    // Only reachable when the auto-stop was throttled, e.g. a background tab.
    assert.equal(validateClip(clip({ durationS: MAX_CLIP_MS / 1000 + 2 })), 'too-long')
  })

  it('checks emptiness before anything else', () => {
    // A zero-byte clip is also silent and also too short. "Empty" is the one
    // that tells the learner something useful.
    assert.equal(
      validateClip(clip({ sizeBytes: 0, durationS: 0, peak: 0 })),
      'empty',
    )
  })
})

describe('what the learner is told', () => {
  const problems: ClipProblem[] = ['empty', 'too-short', 'silent', 'too-long']

  it('has a message for every problem validateClip can return', () => {
    for (const problem of problems) {
      assert.ok(CLIP_PROBLEM[problem], problem)
    }
  })

  it('gives each problem its own distinct code', () => {
    // These drifted once: a too-long recording was reported under the code
    // AUDIO_TOO_SHORT on one screen and RECORDING_EMPTY on another.
    const codes = problems.map((p) => CLIP_PROBLEM[p].code)
    assert.equal(new Set(codes).size, codes.length, codes.join(', '))
  })

  it('names the real limit in the too-long message', () => {
    assert.match(CLIP_PROBLEM['too-long'].message, new RegExp(String(MAX_CLIP_MS / 1000)))
  })

  it('tells the learner what to do next', () => {
    for (const problem of problems) {
      const { message } = CLIP_PROBLEM[problem]
      assert.match(message, /try|hold|check|move/i, problem)
    }
  })

  it('never blames the learner or mentions the machinery', () => {
    for (const problem of problems) {
      const { message } = CLIP_PROBLEM[problem]
      assert.ok(!/\b(you failed|invalid|error|exception|null|undefined)\b/i.test(message))
    }
  })
})

describe('format selection', () => {
  it('falls back to letting the browser choose when nothing is supported', () => {
    // No MediaRecorder in node, which is exactly the unsupported case.
    const format = pickFormat()
    assert.equal(format.mimeType, '')
    assert.equal(format.extension, 'bin')
  })

  it('reports an unsupported environment rather than throwing', () => {
    assert.equal(detectSupport(), 'unsupported')
  })
})
