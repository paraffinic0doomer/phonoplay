import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import {
  ASSESSED_PHONEMES,
  PHONEME_LABEL,
  accessibilityPlan,
  measuredCount,
  planFor,
  standardPlan,
} from './plan.ts'
import { LOW_CONFIDENCE, buildProfile, profileSummary } from './profile.ts'
import type { AssessmentMeasurement } from './profile.ts'
import type { Phoneme } from '../db/index.ts'

/**
 * The assessment.
 *
 * Most of these are about what the profile refuses to say. A percentage is
 * the most authoritative-looking thing this product puts on screen, so the
 * rules for when one is *not* shown carry more weight than the averaging.
 */

const at = (phoneme: Phoneme, similarity: number, confidence = 0.9) => ({
  taskId: `${phoneme}-${similarity}`,
  phoneme,
  similarity,
  confidence,
  assessed: true,
})

describe('the plan', () => {
  it('asks for between six and eight things in standard mode', () => {
    const plan = standardPlan()
    assert.ok(plan.length >= 6 && plan.length <= 8, `${plan.length} prompts`)
  })

  it('covers every sound the profile reports on', () => {
    for (const plan of [standardPlan(), accessibilityPlan()]) {
      const measured = plan.filter((task) => task.measured)
      for (const phoneme of ASSESSED_PHONEMES) {
        assert.ok(
          measured.some((task) => task.phoneme === phoneme),
          `no measured task for ${phoneme}`,
        )
      }
    }
  })

  it('uses a compact subset of the validated standard words in accessibility mode', () => {
    const words = (mode: 'standard' | 'accessibility') =>
      planFor(mode)
        .filter((task) => task.kind === 'word')
        .map((task) => task.text)
        .sort()
    const standard = words('standard')
    const accessibility = words('accessibility')
    assert.equal(accessibility.length, ASSESSED_PHONEMES.length)
    for (const word of accessibility) assert.ok(standard.includes(word))
  })

  it('never targets a sound mid-word', () => {
    // The analyser locates the target at the onset of the utterance. A prompt
    // whose target sits elsewhere would be scored against the wrong audio.
    for (const task of planFor('standard')) {
      const first = task.text.trim().toLowerCase()[0]
      const expected = task.phoneme === 'th' ? 't' : task.phoneme
      assert.equal(first, expected, `${task.text} does not start with ${task.phoneme}`)
    }
  })

  it('keeps the accessibility baseline to four real recordings', () => {
    const plan = accessibilityPlan()
    assert.equal(plan.length, ASSESSED_PHONEMES.length)
    assert.equal(measuredCount(plan), ASSESSED_PHONEMES.length)
    assert.ok(plan.every((task) => task.kind === 'word' && task.measured))
  })

  it('gives every task something to say and a way to say it', () => {
    for (const task of [...standardPlan(), ...accessibilityPlan()]) {
      assert.ok(task.text.trim().length > 0, task.id)
      assert.ok(task.instruction.trim().length > 0, task.id)
    }
  })

  it('has no stress or rhythm task, because neither can be measured yet', () => {
    // Removing this test is the wrong way to add one. The bar is a measured
    // result that beats a coin - see the note at the top of plan.ts.
    const all = [...standardPlan(), ...accessibilityPlan()]
    for (const task of all) {
      assert.ok(!/stress|rhythm|beat|syllable/i.test(task.instruction), task.id)
    }
  })

  it('counts its own measured tasks', () => {
    assert.equal(measuredCount(standardPlan()), standardPlan().length)
    assert.equal(measuredCount(accessibilityPlan()), accessibilityPlan().length)
  })
})

describe('building the profile', () => {
  it('averages the usable recordings for each sound', () => {
    const profile = buildProfile([at('s', 0.9), at('s', 0.8)])
    const s = profile.results.find((r) => r.phoneme === 's')
    assert.equal(s?.score, 85)
    assert.equal(s?.usable, 2)
  })

  it('reports every sound it was asked about, scored or not', () => {
    const profile = buildProfile([at('s', 0.9)])
    assert.equal(profile.results.length, ASSESSED_PHONEMES.length)
    for (const phoneme of ASSESSED_PHONEMES) {
      assert.ok(profile.results.some((r) => r.phoneme === phoneme))
    }
  })

  it('gives no percentage to a sound nothing was measured from', () => {
    const profile = buildProfile([at('s', 0.9)])
    const r = profile.results.find((result) => result.phoneme === 'r')
    assert.equal(r?.score, null)
    assert.equal(r?.usable, 0)
  })

  it('ignores a recording the analyser declined to score', () => {
    // The refused recording still carries a similarity number. Averaging it
    // in would let a reading the analyser would not stand behind move the
    // learner's percentage.
    const refused: AssessmentMeasurement = {
      taskId: 'x',
      phoneme: 's',
      similarity: 0.2,
      confidence: 0.3,
      assessed: false,
    }
    const profile = buildProfile([at('s', 0.9), refused])
    const s = profile.results.find((result) => result.phoneme === 's')
    assert.equal(s?.score, 90)
    assert.equal(s?.usable, 1)
    assert.equal(s?.attempted, 2)
  })

  it('says so when a score rests on weak evidence', () => {
    const profile = buildProfile([at('s', 0.9, LOW_CONFIDENCE - 0.1)])
    const s = profile.results.find((result) => result.phoneme === 's')
    assert.equal(s?.lowConfidence, true)
    assert.equal(s?.score, 90, 'the score is still reported, just labelled')
  })
})

describe('choosing the first focus', () => {
  it('picks the weakest sound that was measured well', () => {
    const profile = buildProfile([
      at('s', 0.91),
      at('l', 0.84),
      at('r', 0.61),
      at('th', 0.48),
    ])
    assert.equal(profile.firstFocus, 'th')
  })

  it('never sends a learner to a sound it is unsure about', () => {
    // A low-confidence 0.10 would otherwise beat a confident 0.60 and point
    // the learner at whichever sound happened to record worst.
    const profile = buildProfile([
      at('th', 0.1, LOW_CONFIDENCE - 0.2),
      at('r', 0.6, 0.95),
      at('s', 0.9, 0.95),
    ])
    assert.equal(profile.firstFocus, 'r')
  })

  it('names no focus at all when nothing was measured confidently', () => {
    const profile = buildProfile([at('s', 0.5, LOW_CONFIDENCE - 0.2)])
    assert.equal(profile.firstFocus, null)
  })

  it('names no focus when every recording was refused', () => {
    const profile = buildProfile([
      { taskId: 'a', phoneme: 's', similarity: null, confidence: null, assessed: false },
    ])
    assert.equal(profile.firstFocus, null)
    assert.equal(profile.usable, false)
  })
})

describe('what the learner is told', () => {
  it('explains an unmeasurable sitting without blaming them', () => {
    const summary = profileSummary(buildProfile([]))
    assert.match(summary, /could not measure/i)
    assert.match(summary, /nothing is wrong/i)
  })

  it('says the evidence was thin rather than inventing a focus', () => {
    const summary = profileSummary(buildProfile([at('s', 0.5, 0.2)]))
    assert.match(summary, /not clear enough/i)
  })

  it('never uses clinical or diagnostic language', () => {
    const profiles = [
      buildProfile([]),
      buildProfile([at('s', 0.5, 0.2)]),
      buildProfile([at('s', 0.9), at('th', 0.4)]),
    ]
    for (const profile of profiles) {
      const text = profileSummary(profile).toLowerCase()
      for (const term of [
        'dyslexia',
        'disorder',
        'diagnos',
        'impair',
        'therapy',
        'treatment',
        'abnormal',
        'deficit',
        'delay',
      ]) {
        assert.ok(!text.includes(term), `summary uses "${term}"`)
      }
    }
  })

  it('labels the sounds the way the profile screen shows them', () => {
    for (const phoneme of ASSESSED_PHONEMES) {
      assert.match(PHONEME_LABEL[phoneme], /^\/[A-Z]+\/$/)
    }
  })
})
