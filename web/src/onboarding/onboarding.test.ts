import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import { DEFAULT_SETTINGS, freshSettings } from '../db/settings.ts'
import {
  GOAL_CHOICES,
  LEVEL_CHOICES,
  MODE_CHOICES,
  MODE_NOTE,
  OTHER,
  STEP_COUNT,
  STEP_TITLES,
  nativeLanguageChoices,
  targetLanguageChoices,
} from './questions.ts'

/**
 * Onboarding.
 *
 * Two kinds of test here. The first kind pins two bugs found by walking the
 * flow in a real browser. The second kind guards the language: onboarding is
 * where a learner is most likely to be asked something they should never be
 * asked, so the wording is asserted rather than reviewed.
 */

describe('the onboarded signal', () => {
  it('does not depend on two separately generated timestamps', () => {
    // `createdAt` and `updatedAt` came from two `now()` calls that could
    // straddle a millisecond. Roughly 1 in 1200 fresh profiles then looked
    // edited, and the learner was skipped past onboarding entirely.
    for (let i = 0; i < 20000; i++) {
      const s = freshSettings()
      assert.equal(s.createdAt, s.updatedAt)
    }
  })

  it('leaves the goal empty, which is what marks a profile un-onboarded', () => {
    assert.equal(DEFAULT_SETTINGS.learningGoal, '')
    assert.equal(freshSettings().learningGoal, '')
  })

  it('offers Standard by default, never Accessibility Mode', () => {
    // The mode is chosen, never assigned.
    assert.equal(DEFAULT_SETTINGS.learningMode, 'standard')
  })
})

describe('the questions', () => {
  it('has one title per step', () => {
    assert.equal(STEP_TITLES.length, STEP_COUNT)
    for (const title of STEP_TITLES) assert.match(title, /\?$/)
  })

  it('puts Bangla first among first languages', () => {
    const choices = nativeLanguageChoices()
    assert.equal(choices[0].value, 'bn')
    assert.equal(choices[0].nativeLabel, 'বাংলা')
  })

  it('ends the first-language list with Other', () => {
    const choices = nativeLanguageChoices()
    assert.equal(choices.at(-1)?.value, OTHER)
    // The sentinel must never reach the database as a language code.
    assert.ok(OTHER.startsWith('__'))
  })

  it('offers only targets the engine can actually measure', () => {
    const targets = targetLanguageChoices()
    assert.deepEqual(
      targets.map((t) => t.value),
      ['en'],
    )
  })

  it('never offers a target that has no reference recordings', () => {
    const targets = targetLanguageChoices().map((t) => t.value)
    for (const unsupported of ['bn', 'es']) {
      assert.ok(!targets.includes(unsupported))
    }
  })

  it('keeps every choice value stable and storable', () => {
    // These strings are written to IndexedDB. Renaming one silently orphans
    // every profile already saved with the old value.
    assert.deepEqual(
      LEVEL_CHOICES.map((c) => c.value),
      ['beginner', 'intermediate', 'advanced'],
    )
    assert.deepEqual(
      GOAL_CHOICES.map((c) => c.value),
      ['conversation', 'academic', 'professional', 'travel', 'general'],
    )
    assert.deepEqual(
      MODE_CHOICES.map((c) => c.value),
      ['standard', 'accessibility'],
    )
  })
})

describe('what onboarding is not allowed to say', () => {
  const everything = [
    ...STEP_TITLES,
    MODE_NOTE,
    ...[...nativeLanguageChoices(), ...targetLanguageChoices()].flatMap((c) => [
      c.label,
      c.detail ?? '',
    ]),
    ...[...LEVEL_CHOICES, ...GOAL_CHOICES, ...MODE_CHOICES].flatMap((c) => [
      c.label,
      c.detail ?? '',
    ]),
  ].join(' ')

  it('never names a condition', () => {
    for (const term of [
      'dyslexia',
      'dyslexic',
      'disorder',
      'diagnos',
      'disability',
      'impair',
      'symptom',
      'clinical',
      'therapy',
      'treatment',
      'special needs',
    ]) {
      assert.ok(
        !everything.toLowerCase().includes(term),
        `onboarding copy must not contain "${term}"`,
      )
    }
  })

  it('never asks the learner to disclose anything medical', () => {
    for (const rx of [
      /do you have\b/i,
      /have you been\b/i,
      /(are|were) you diagnos/i,
      /(select|tick|check) (this box )?if you\b/i,
    ]) {
      assert.ok(!rx.test(everything), `onboarding must not ask: ${rx.source}`)
    }
  })

  it('describes Accessibility Mode as a way of working', () => {
    // The exact framing CLAUDE.md allows: about the practice, not the person.
    assert.match(
      MODE_NOTE,
      /may be useful for learners who benefit from additional phonological practice/,
    )
    assert.match(MODE_NOTE, /switch between modes at any time/)
    assert.ok(!/\byou (are|have|need|struggle|suffer)\b/i.test(MODE_NOTE))
  })

  it('describes the mode by what practice looks like', () => {
    const accessibility = MODE_CHOICES.find((c) => c.value === 'accessibility')
    assert.equal(accessibility?.label, 'Accessibility Mode')
    assert.match(accessibility?.detail ?? '', /smaller steps/i)
    assert.match(accessibility?.detail ?? '', /repetition/i)
  })
})
