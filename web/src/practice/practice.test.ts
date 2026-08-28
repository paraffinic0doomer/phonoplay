import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

/**
 * The practice engine's shared pieces.
 *
 * The evidence assembler is the only thing in this feature that sends
 * anything about a learner off the device, so what it may and may not carry
 * is worth pinning down rather than reviewing by eye.
 */

/* ── What leaves the device for exercise generation ───────────────── */

describe('exercise evidence', () => {
  it('sends nothing that could identify a learner', async () => {
    // The evidence is the only thing this feature transmits about a learner,
    // so the shape is worth pinning: measurements and preferences, never an
    // id, a timestamp, or free text they typed.
    const source = (await import('node:fs')).readFileSync(
      new URL('./evidence.ts', import.meta.url),
      'utf8',
    )
    for (const forbidden of [
      'sessionId',
      'learnerId',
      'createdAt',
      'updatedAt',
      'lastPracticed',
      'id:',
    ]) {
      assert.ok(!source.includes(forbidden), `evidence includes ${forbidden}`)
    }
  })

  it('carries every field the generator expects', async () => {
    const source = (await import('node:fs')).readFileSync(
      new URL('./evidence.ts', import.meta.url),
      'utf8',
    )
    for (const field of [
      'target_phoneme',
      'mastery',
      'confidence',
      'recent_scores',
      'current_stage',
      'learning_mode',
      'exercise_type',
      'contrast_accuracy',
      'native_language',
      'target_language',
    ]) {
      assert.ok(source.includes(field), `evidence is missing ${field}`)
    }
  })

  it('sends null, not zero, for a learner with no history', async () => {
    // Nought mastery and no mastery are different things, and the generator
    // pitches very differently for the two.
    const source = (await import('node:fs')).readFileSync(
      new URL('./evidence.ts', import.meta.url),
      'utf8',
    )
    assert.match(source, /attempts === 0 \? null : profile\.masteryScore/)
    assert.match(source, /attempts === 0 \? null : profile\.confidence/)
    assert.match(source, /attempts === 0 \? null : contrast\.accuracy/)
  })
})
