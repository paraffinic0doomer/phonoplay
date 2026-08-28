import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { decideAdaptation } from './syllabus.ts'
import type { PhonemeProfile } from '../db/index.ts'

function profile(overrides: Partial<PhonemeProfile> = {}): PhonemeProfile {
  return {
    id: 'th', phoneme: 'th', masteryScore: .42, confidence: .8, attempts: 3,
    recentScores: [.4, .43, .42], trend: 'stable', consistency: .9,
    currentStage: 'sound', repetitionCount: 3, contrastAccuracy: null,
    lastPracticed: null, updatedAt: '', ...overrides,
  }
}

describe('adaptive syllabus decisions', () => {
  it('keeps a weak TH on the same small step with new content', () => {
    const result = decideAdaptation(profile(), 'accessibility')
    assert.equal(result.action, 'reinforce')
    assert.equal(result.stage, 'sound')
  })

  it('advances only after enough strong, consistent evidence', () => {
    const result = decideAdaptation(profile({ masteryScore: .84, confidence: .8, consistency: .9, trend: 'improving', repetitionCount: 5 }), 'accessibility')
    assert.equal(result.action, 'advance')
    assert.equal(result.stage, 'syllable')
  })

  it('returns an inconsistent run to the immediately easier available step', () => {
    const result = decideAdaptation(profile({ currentStage: 'word', trend: 'inconsistent', repetitionCount: 4 }), 'accessibility')
    assert.equal(result.action, 'simplify')
    assert.equal(result.stage, 'minimal_pair')
  })
})
