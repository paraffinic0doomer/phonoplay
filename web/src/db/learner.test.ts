import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import { deriveConsistency, deriveTrend } from './phonemes.ts'
import {
  ACCESSIBILITY_POLICY,
  STANDARD_POLICY,
  assessMastery,
  assessStage,
  policyFor,
} from './policy.ts'
import type { LearnerPolicy } from './policy.ts'
import { ladderIndex } from './policy.ts'
import { normaliseContrast } from './contrasts.ts'
import { STAGE_ORDER, migrateProfileToV2 } from './schema.ts'
import type { PhonemeProfile, SkillType, Trend } from './schema.ts'

/**
 * The learner model.
 *
 * The rules here decide what a learner is asked to do next, so most of these
 * tests are about what the model refuses to conclude: mastery from one good
 * recording, a direction from two data points, progress from measurements the
 * analyser was unsure about.
 *
 * The Dexie-backed functions are exercised in the browser; everything below
 * is the pure arithmetic and the pure rules, which is where the judgement is.
 */

function profile(overrides: Partial<PhonemeProfile> = {}): PhonemeProfile {
  return {
    id: 'p',
    phoneme: 's',
    masteryScore: 0.9,
    confidence: 0.9,
    attempts: 6,
    recentScores: [0.88, 0.9, 0.91, 0.9],
    trend: 'stable',
    consistency: 0.95,
    currentStage: 'word',
    repetitionCount: 5,
    contrastAccuracy: null,
    lastPracticed: null,
    updatedAt: '',
    ...overrides,
  }
}

/* ── Trend ────────────────────────────────────────────────────────── */

describe('trend', () => {
  it('reports improvement', () => {
    assert.equal(deriveTrend([0.3, 0.4, 0.5, 0.6, 0.75]), 'improving')
  })

  it('reports regression', () => {
    assert.equal(deriveTrend([0.85, 0.8, 0.7, 0.6, 0.45]), 'declining')
  })

  it('reports stability', () => {
    assert.equal(deriveTrend([0.7, 0.72, 0.69, 0.71, 0.7]), 'stable')
  })

  it('reports inconsistency', () => {
    // No net direction, but bouncing across most of the scale.
    assert.equal(deriveTrend([0.2, 0.9, 0.25, 0.85, 0.3, 0.88]), 'inconsistent')
  })

  it('calls steady improvement improving, not inconsistent', () => {
    // A learner who is genuinely improving has a wide spread by definition.
    // Checking spread before direction used to misread exactly this case.
    assert.equal(deriveTrend([0.4, 0.6, 0.8]), 'improving')
  })

  it('claims no direction from fewer than three attempts', () => {
    assert.equal(deriveTrend([]), 'new')
    assert.equal(deriveTrend([0.9]), 'new')
    assert.equal(deriveTrend([0.2, 0.9]), 'new')
  })

  it('only ever returns a trend the type allows', () => {
    const allowed: Trend[] = ['improving', 'stable', 'declining', 'inconsistent', 'new']
    const samples = [[], [0.5], [0.1, 0.9], [0.3, 0.4, 0.5], [0.9, 0.5, 0.1], [0.5, 0.5, 0.5]]
    for (const scores of samples) {
      assert.ok(allowed.includes(deriveTrend(scores)), JSON.stringify(scores))
    }
  })
})

/* ── Consistency ──────────────────────────────────────────────────── */

describe('consistency', () => {
  it('is high when the scores agree', () => {
    assert.ok(deriveConsistency([0.8, 0.82, 0.79, 0.81]) > 0.9)
  })

  it('is low when they scatter', () => {
    assert.ok(deriveConsistency([0.1, 0.9, 0.2, 0.95]) < 0.3)
  })

  it('is independent of how good the scores are', () => {
    // A learner scoring 0.4 every time is consistent and not yet accurate.
    // Conflating the two would let a high average hide wild variation.
    const low = deriveConsistency([0.4, 0.4, 0.41, 0.39])
    const high = deriveConsistency([0.9, 0.9, 0.91, 0.89])
    assert.ok(Math.abs(low - high) < 0.05, `${low} vs ${high}`)
  })

  it('claims nothing from a single attempt', () => {
    assert.equal(deriveConsistency([0.9]), 0)
    assert.equal(deriveConsistency([]), 0)
  })

  it('stays within range', () => {
    for (const scores of [[0, 1], [1, 1], [0, 0], [0.5, 0.5, 0.5], [0, 1, 0, 1]]) {
      const value = deriveConsistency(scores)
      assert.ok(value >= 0 && value <= 1, `${JSON.stringify(scores)} -> ${value}`)
    }
  })
})

/* ── Mastery ──────────────────────────────────────────────────────── */

describe('mastery', () => {
  it('is granted when every kind of evidence agrees', () => {
    assert.equal(assessMastery(profile(), STANDARD_POLICY).mastered, true)
  })

  it('is never granted from one good attempt', () => {
    // The headline rule. One recording can produce a high score - it is the
    // best estimate available from one reading - but it is not mastery.
    const verdict = assessMastery(
      profile({ attempts: 1, masteryScore: 0.97, recentScores: [0.97], trend: 'new', consistency: 0 }),
      STANDARD_POLICY,
    )
    assert.equal(verdict.mastered, false)
    assert.ok(verdict.blockers.includes('too-few-attempts'))
  })

  it('is withheld when the analyser was unsure', () => {
    // High similarity the analyser had no confidence in is evidence of a
    // measurement problem, not of a skill.
    const verdict = assessMastery(profile({ confidence: 0.3 }), STANDARD_POLICY)
    assert.equal(verdict.mastered, false)
    assert.deepEqual(verdict.blockers, ['confidence-too-low'])
  })

  it('is withheld when the scores do not agree with each other', () => {
    const verdict = assessMastery(profile({ consistency: 0.2 }), STANDARD_POLICY)
    assert.equal(verdict.mastered, false)
    assert.deepEqual(verdict.blockers, ['not-consistent-enough'])
  })

  it('is withheld while the trend is downward', () => {
    const verdict = assessMastery(profile({ trend: 'declining' }), STANDARD_POLICY)
    assert.equal(verdict.mastered, false)
    assert.deepEqual(verdict.blockers, ['trend'])
  })

  it('is withheld while performance is erratic', () => {
    assert.equal(
      assessMastery(profile({ trend: 'inconsistent' }), STANDARD_POLICY).mastered,
      false,
    )
  })

  it('reports every reason, not just the first', () => {
    const verdict = assessMastery(
      profile({ attempts: 1, masteryScore: 0.2, confidence: 0.1, consistency: 0, trend: 'declining' }),
      STANDARD_POLICY,
    )
    assert.equal(verdict.blockers.length, 5)
  })
})

/* ── Stages ───────────────────────────────────────────────────────── */

describe('stages', () => {
  it('supports every stage the product asks for', () => {
    for (const stage of ['sound', 'syllable', 'word', 'minimal_pair', 'phrase', 'sentence']) {
      assert.ok(STAGE_ORDER.includes(stage as SkillType), stage)
    }
  })

  it('walks the ladder the brief specifies for standard mode', () => {
    assert.deepEqual(STANDARD_POLICY.stages, ['sound', 'word', 'phrase', 'sentence'])
  })

  it('walks the longer ladder for accessibility mode', () => {
    // Minimal pairs come *before* whole words here: the contrast is heard
    // before it has to be produced inside a word.
    assert.deepEqual(ACCESSIBILITY_POLICY.stages, [
      'sound',
      'syllable',
      'minimal_pair',
      'word',
      'phrase',
      'sentence',
    ])
  })

  it('advances one rung at a time', () => {
    const verdict = assessStage(profile({ currentStage: 'word' }), STANDARD_POLICY)
    assert.equal(verdict.advance, true)
    assert.equal(verdict.stage, 'phrase')
  })

  it('advances along the mode’s own ladder, not a shared one', () => {
    const ready = profile({ currentStage: 'sound', attempts: 8, repetitionCount: 8 })
    assert.equal(assessStage(ready, STANDARD_POLICY).stage, 'word')
    assert.equal(assessStage(ready, ACCESSIBILITY_POLICY).stage, 'syllable')
  })

  it('does not advance on evidence alone, without time at the stage', () => {
    const verdict = assessStage(profile({ repetitionCount: 1 }), STANDARD_POLICY)
    assert.equal(verdict.advance, false)
    assert.equal(verdict.stage, 'word')
  })

  it('does not advance on repetition alone, without evidence', () => {
    const verdict = assessStage(
      profile({ repetitionCount: 50, masteryScore: 0.2 }),
      STANDARD_POLICY,
    )
    assert.equal(verdict.advance, false)
  })

  it('never moves a learner backwards', () => {
    // A bad run is a pause, not a demotion. CLAUDE.md rules out punitive
    // failure, and being sent down a rung for one poor day is exactly that.
    for (const trend of ['declining', 'inconsistent'] as Trend[]) {
      for (const policy of [STANDARD_POLICY, ACCESSIBILITY_POLICY]) {
        for (const stage of policy.stages) {
          const verdict = assessStage(
            profile({ currentStage: stage, trend, masteryScore: 0.1, consistency: 0 }),
            policy,
          )
          assert.equal(verdict.stage, stage, `${stage} / ${trend}`)
          assert.equal(verdict.advance, false)
        }
      }
    }
  })

  it('stops at the top of the ladder', () => {
    const verdict = assessStage(profile({ currentStage: 'sentence' }), STANDARD_POLICY)
    assert.equal(verdict.advance, false)
    assert.equal(verdict.stage, 'sentence')
  })

  it('notices a learner who has been on one stage a long time', () => {
    const stuck = assessStage(
      profile({ repetitionCount: 20, masteryScore: 0.3, consistency: 0.2 }),
      STANDARD_POLICY,
    )
    assert.equal(stuck.needsSupport, true)
    // Noticing is not penalising: the stage is untouched.
    assert.equal(stuck.stage, 'word')
  })
})

/* ── Accessibility Mode ───────────────────────────────────────────── */

describe('accessibility mode', () => {
  it('is selected by the learning mode', () => {
    assert.equal(policyFor('accessibility'), ACCESSIBILITY_POLICY)
    assert.equal(policyFor('standard'), STANDARD_POLICY)
  })

  it('asks for more evidence before believing a score', () => {
    assert.ok(ACCESSIBILITY_POLICY.minAttempts > STANDARD_POLICY.minAttempts)
    assert.ok(ACCESSIBILITY_POLICY.minConsistency >= STANDARD_POLICY.minConsistency)
    assert.ok(ACCESSIBILITY_POLICY.minConfidence >= STANDARD_POLICY.minConfidence)
  })

  it('tolerates far more repetition before calling anyone stuck', () => {
    assert.ok(
      ACCESSIBILITY_POLICY.repetitionsBeforeSupport >=
        STANDARD_POLICY.repetitionsBeforeSupport * 2,
    )
  })

  it('never demands a higher score than standard mode', () => {
    // Raising the bar would mean asking more of the learners this mode exists
    // to support. What is raised is the evidence, not the standard.
    assert.ok(ACCESSIBILITY_POLICY.minMastery <= STANDARD_POLICY.minMastery)
  })

  it('holds back a learner standard mode would have advanced', () => {
    const four = profile({ attempts: 4, repetitionCount: 4 })
    assert.equal(assessStage(four, STANDARD_POLICY).advance, true)
    assert.equal(assessStage(four, ACCESSIBILITY_POLICY).advance, false)
  })

  it('advances the same learner once the evidence is there', () => {
    const six = profile({ attempts: 6, repetitionCount: 6, consistency: 0.95 })
    assert.equal(assessStage(six, ACCESSIBILITY_POLICY).advance, true)
  })

  it('does not treat a long stay on one stage as failure', () => {
    // Twelve repetitions is "stuck" in standard mode and ordinary here.
    const many = profile({ repetitionCount: 12 })
    assert.equal(assessStage(many, STANDARD_POLICY).needsSupport, true)
    assert.equal(assessStage(many, ACCESSIBILITY_POLICY).needsSupport, false)
  })
})

/* ── The rules are data ───────────────────────────────────────────── */

describe('the policies themselves', () => {
  it('are plain objects a product decision can change', () => {
    const custom: LearnerPolicy = { ...STANDARD_POLICY, minAttempts: 99 }
    assert.equal(assessMastery(profile(), custom).mastered, false)
    assert.equal(assessMastery(profile(), STANDARD_POLICY).mastered, true)
  })

  it('keep every threshold inside the range it is compared against', () => {
    for (const policy of [STANDARD_POLICY, ACCESSIBILITY_POLICY]) {
      for (const key of ['minMastery', 'minConfidence', 'minConsistency'] as const) {
        assert.ok(policy[key] >= 0 && policy[key] <= 1, `${key} = ${policy[key]}`)
      }
      assert.ok(policy.minAttempts >= 1)
      assert.ok(policy.repetitionsBeforeSupport > policy.repetitionsToAdvance)
    }
  })
})

/* ── Minimal pairs ────────────────────────────────────────────────── */

describe('contrast identity', () => {
  it('treats a pair the same whichever way round it is named', () => {
    assert.equal(normaliseContrast('th-s'), normaliseContrast('s-th'))
    assert.equal(normaliseContrast('S/TH'), normaliseContrast('th-s'))
  })

  it('produces a stable key', () => {
    assert.equal(normaliseContrast('r-w'), 'r-w')
    assert.equal(normaliseContrast(' W - R '), 'r-w')
  })
})

/* ── Migrating existing learners ──────────────────────────────────── */

describe('the v1 to v2 migration', () => {
  it('backfills the field v1 never had', () => {
    const row: Record<string, unknown> = { phoneme: 's', masteryScore: 0.8 }
    migrateProfileToV2(row)
    assert.equal(row.consistency, 0)
  })

  it('does not claim consistency the data cannot support', () => {
    // Zero, not one. A v1 row carries no evidence about spread, and starting
    // an existing learner at "perfectly consistent" would hand them a mastery
    // verdict nothing measured.
    const row: Record<string, unknown> = { phoneme: 's' }
    migrateProfileToV2(row)
    assert.notEqual(row.consistency, 1)
  })

  it('renames the stage v1 called "isolated"', () => {
    const row: Record<string, unknown> = { currentStage: 'isolated' }
    migrateProfileToV2(row)
    assert.equal(row.currentStage, 'sound')
  })

  it('renames the trend v1 called "steady"', () => {
    const row: Record<string, unknown> = { trend: 'steady' }
    migrateProfileToV2(row)
    assert.equal(row.trend, 'stable')
  })

  it('leaves everything else exactly as it found it', () => {
    const row: Record<string, unknown> = {
      phoneme: 'r',
      masteryScore: 0.62,
      attempts: 9,
      recentScores: [0.6, 0.62, 0.64],
      currentStage: 'word',
      trend: 'improving',
      repetitionCount: 4,
    }
    migrateProfileToV2(row)
    assert.equal(row.masteryScore, 0.62)
    assert.equal(row.attempts, 9)
    assert.equal(row.currentStage, 'word')
    assert.equal(row.trend, 'improving')
    assert.equal(row.repetitionCount, 4)
    assert.deepEqual(row.recentScores, [0.6, 0.62, 0.64])
  })

  it('is safe to run twice', () => {
    // Dexie should run it once, but a migration that corrupts data on a
    // second pass is a migration waiting to corrupt data.
    const row: Record<string, unknown> = { currentStage: 'isolated', trend: 'steady' }
    migrateProfileToV2(row)
    const once = { ...row }
    migrateProfileToV2(row)
    assert.deepEqual(row, once)
  })

  it('produces a stage and trend the current types allow', () => {
    for (const stage of ['isolated', 'word', 'sentence']) {
      const row: Record<string, unknown> = { currentStage: stage }
      migrateProfileToV2(row)
      assert.ok(STAGE_ORDER.includes(row.currentStage as never), String(row.currentStage))
    }
    const allowed: Trend[] = ['improving', 'stable', 'declining', 'inconsistent', 'new']
    for (const trend of ['steady', 'improving', 'new']) {
      const row: Record<string, unknown> = { trend }
      migrateProfileToV2(row)
      assert.ok(allowed.includes(row.trend as Trend), String(row.trend))
    }
  })
})

/* ── Changing modes mid-sound ─────────────────────────────────────── */

describe('switching modes', () => {
  it('keeps a learner where they are when the rung exists in both', () => {
    for (const stage of ['sound', 'word', 'phrase', 'sentence'] as SkillType[]) {
      assert.equal(
        ACCESSIBILITY_POLICY.stages[ladderIndex(stage, ACCESSIBILITY_POLICY.stages)],
        stage,
        stage,
      )
    }
  })

  it('never sends anyone back to the beginning for changing mode', () => {
    // A learner part-way up the accessibility ladder switching to standard
    // must not lose the rungs they climbed.
    const index = ladderIndex('minimal_pair', STANDARD_POLICY.stages)
    assert.ok(index > 0, `landed at ${STANDARD_POLICY.stages[index]}`)
  })

  it('lands on the last rung they actually earned, never further', () => {
    // `syllable` is not on the standard ladder. It sits above `sound` and
    // below `word`, so a learner on it belongs at `sound` — they have not
    // practised whole words yet, and claiming they have would skip a rung.
    assert.equal(STANDARD_POLICY.stages[ladderIndex('syllable', STANDARD_POLICY.stages)], 'sound')

    // `minimal_pair` sits above `word` in the canonical order, so someone who
    // reached it has already done words.
    assert.equal(
      STANDARD_POLICY.stages[ladderIndex('minimal_pair', STANDARD_POLICY.stages)],
      'word',
    )
  })

  it('advances from a rung that is not on the current ladder', () => {
    // The verdict has to be a stage this mode can actually present.
    const ready = profile({ currentStage: 'syllable', attempts: 8, repetitionCount: 8 })
    const verdict = assessStage(ready, STANDARD_POLICY)
    assert.ok(STANDARD_POLICY.stages.includes(verdict.stage), verdict.stage)
  })

  it('always returns a stage from the active ladder', () => {
    for (const policy of [STANDARD_POLICY, ACCESSIBILITY_POLICY]) {
      for (const stage of STAGE_ORDER) {
        for (const repetitionCount of [0, 99]) {
          const verdict = assessStage(profile({ currentStage: stage, repetitionCount }), policy)
          assert.ok(
            policy.stages.includes(verdict.stage),
            `${stage} -> ${verdict.stage} not on ${policy.stages.join(',')}`,
          )
        }
      }
    }
  })
})
