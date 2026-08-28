import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { LanguageKnowledgeService as svc } from './service.ts'
import { ENGLISH_PHONEMES } from './english.ts'

/**
 * Language and phoneme lookup.
 *
 * Run with Node's built-in runner, which executes TypeScript directly:
 *
 *     npm run test
 *
 * No test framework is installed. This layer is pure data and pure lookup
 * with no browser API in sight, so the runtime already in the toolchain is
 * enough — and a dependency added to test a lookup table would be one more
 * thing to keep working for no benefit.
 */

describe('language lookup', () => {
  test('lists the first languages onboarding offers', () => {
    const codes = svc.getSupportedLanguages().map((l) => l.code).sort()
    assert.deepEqual(codes, ['bn', 'en'])
  })

  test('future languages are registered but not offered before their profiles are complete', () => {
    const spanish = svc.getLanguage('es')
    assert.ok(spanish)
    assert.equal(spanish.canBeNative, false)
    assert.equal(spanish.canBeTarget, false)
    assert.equal(svc.getLanguagePairProfile('es', 'en'), undefined)
  })

  test('a first language typed by hand degrades to the default ordering', () => {
    // "Other" stores whatever the learner typed. Every lookup misses, which
    // is the designed outcome: no bridge, no crash, plain ordering.
    assert.equal(svc.getLanguage('Tagalog'), undefined)
    assert.equal(svc.getLanguagePairProfile('Tagalog', 'en'), undefined)
    assert.deepEqual(
      svc.getAssessmentPrompts({ native: 'Tagalog' as never }).map((p) => p.text),
      svc.getAssessmentPrompts().map((p) => p.text),
    )
  })

  test('offers only English as a target', () => {
    // Not a ranking. There is no Bangla acoustic reference data, so there is
    // nothing to measure a Bangla target against.
    assert.deepEqual(svc.getTargetLanguages().map((l) => l.code), ['en'])
  })

  test('keeps target configuration together in the language profile', () => {
    const english = svc.getLanguage('en')
    assert.ok(english)
    assert.equal(english.languageCode, 'en')
    assert.ok(english.phonemeInventory.length >= 4)
    assert.ok(english.examples.length > 0)
    assert.ok(english.assessmentPrompts.length > 0)
    assert.ok(english.supportedExerciseTypes.includes('minimal_pair'))
  })

  test('Bangla is native-capable but not a target, and says why', () => {
    const bangla = svc.getLanguage('bn')
    assert.ok(bangla)
    assert.equal(bangla.canBeNative, true)
    assert.equal(bangla.canBeTarget, false)
    assert.match(bangla.targetNote ?? '', /English only/)
  })

  test('carries each language in its own script', () => {
    assert.equal(svc.getLanguage('bn')?.nativeName, 'বাংলা')
    assert.equal(svc.getLanguage('bn')?.script, 'Bengali')
    assert.equal(svc.getLanguage('en')?.nativeName, 'English')
  })

  test('an unknown language returns undefined rather than throwing', () => {
    // A stale link should render an empty state, not break the page.
    assert.equal(svc.getLanguage('klingon'), undefined)
    assert.equal(svc.getLanguage(''), undefined)
  })
})

describe('phoneme lookup', () => {
  test('returns the four measurable MVP sounds by default', () => {
    const ids = svc.getPhonemes().map((p) => p.id).sort()
    assert.deepEqual(ids, ['l', 'r', 's', 'th'])
  })

  test('includes the voiced /th/ only when unmeasurable sounds are asked for', () => {
    const withUnmeasurable = svc.getPhonemes({ assessableOnly: false }).map((p) => p.id)
    assert.ok(withUnmeasurable.includes('dh'))
    assert.ok(!svc.getPhonemes().map((p) => p.id).includes('dh'))
  })

  test('distinguishes the two /th/ sounds', () => {
    // English writes one digraph for two phonemes. "thigh" and "thy" differ
    // only in voicing, so they are separate entries, not variants of one.
    const voiceless = svc.getPhoneme('th')
    const voiced = svc.getPhoneme('dh', 'en')

    assert.ok(voiceless && voiced)
    assert.equal(voiceless.ipa, 'θ')
    assert.equal(voiced.ipa, 'ð')
    assert.equal(voiceless.voiced, false)
    assert.equal(voiced.voiced, true)
    assert.notEqual(voiceless.id, voiced.id)
  })

  test('the voiced /th/ is flagged as not measurable, with a reason', () => {
    const voiced = svc.getPhonemes({ assessableOnly: false }).find((p) => p.id === 'dh')
    assert.ok(voiced)
    assert.equal(voiced.assessable, false)
    assert.match(voiced.assessmentNote ?? '', /cannot measure/)
  })

  test('every phoneme carries the required knowledge', () => {
    for (const phoneme of svc.getPhonemes({ assessableOnly: false })) {
      assert.ok(phoneme.ipa, `${phoneme.id} has no IPA`)
      assert.ok(phoneme.category, `${phoneme.id} has no category`)
      assert.ok(phoneme.positions.length > 0, `${phoneme.id} has no positions`)
      assert.ok(
        phoneme.difficulty >= 1 && phoneme.difficulty <= 5,
        `${phoneme.id} difficulty out of range`,
      )
      assert.ok(phoneme.description.length > 20, `${phoneme.id} description too thin`)
      assert.ok(phoneme.articulation.length > 20, `${phoneme.id} articulation too thin`)
      assert.ok(phoneme.examples.length >= 4, `${phoneme.id} needs more examples`)
    }
  })

  test('an unknown phoneme returns undefined and no examples', () => {
    assert.equal(svc.getPhoneme('zz'), undefined)
    assert.deepEqual(svc.getPhonemeExamples('zz'), [])
  })
})

describe('examples', () => {
  test('are hand-authored, not assembled at runtime', () => {
    // Two calls must give identical objects. A generated list would drift,
    // and a word that does not contain the sound would corrupt the
    // measurement downstream.
    assert.deepEqual(svc.getPhonemeExamples('s'), svc.getPhonemeExamples('s'))
  })

  test('can be filtered by word position', () => {
    const initial = svc.getPhonemeExamples('s', { position: 'initial' })
    const final = svc.getPhonemeExamples('s', { position: 'final' })

    assert.ok(initial.length > 0 && final.length > 0)
    assert.ok(initial.every((e) => e.position === 'initial'))
    assert.ok(final.every((e) => e.position === 'final'))
  })

  test('word-initial examples really do start with their sound', () => {
    // The spelling check the material generator uses. A word that does not
    // begin with the target sound would be measured against something that
    // is not there.
    const startsWith: Record<string, RegExp> = {
      s: /^s(?!h)/i,
      r: /^(r|wr)/i,
      l: /^l/i,
      th: /^th/i,
      dh: /^th/i,
    }
    for (const phoneme of svc.getPhonemes({ assessableOnly: false })) {
      for (const example of phoneme.examples.filter((e) => e.position === 'initial')) {
        assert.match(
          example.word,
          startsWith[phoneme.id],
          `${example.word} does not start with /${phoneme.id}/`,
        )
      }
    }
  })

  test('contrast examples name the sound they contrast with', () => {
    const contrasts = svc.getContrastExamples('s')
    assert.ok(contrasts.length > 0)
    for (const example of contrasts) {
      assert.ok(example.contrast, `${example.word} has no contrast word`)
      assert.ok(example.contrastPhoneme, `${example.word} has no contrast phoneme`)
      assert.notEqual(example.contrast, example.word)
    }
  })
})

describe('assessment prompts', () => {
  test('cover every measurable sound', () => {
    const covered = new Set(svc.getAssessmentPrompts().map((p) => p.phoneme))
    for (const phoneme of svc.getPhonemes()) {
      assert.ok(covered.has(phoneme.id), `${phoneme.id} is not assessed`)
    }
  })

  test('never ask for a sound that cannot be measured', () => {
    const measurable = new Set(svc.getPhonemes().map((p) => p.id))
    for (const prompt of svc.getAssessmentPrompts()) {
      assert.ok(measurable.has(prompt.phoneme), `${prompt.phoneme} is not measurable`)
    }
  })

  test('are all word-initial, matching what the analyser can locate', () => {
    for (const prompt of svc.getAssessmentPrompts()) {
      assert.equal(prompt.position, 'initial', `${prompt.text} is not word-initial`)
    }
  })

  test('are ordered by the language pair when one is given', () => {
    const ordered = svc.getAssessmentPrompts({ native: 'bn' })
    const pair = svc.getLanguagePairProfile('bn', 'en')
    assert.ok(pair)

    const firstHint = pair.hints.find((h) => h.suggestedOrder === 1)
    assert.equal(ordered[0].phoneme, firstHint?.phoneme)
  })

  test('an unknown pair falls back to the default order without throwing', () => {
    const fallback = svc.getAssessmentPrompts({ native: 'klingon' as never })
    assert.deepEqual(
      fallback.map((p) => p.text),
      svc.getAssessmentPrompts().map((p) => p.text),
    )
  })

  test('respect a limit while keeping the ordering', () => {
    const limited = svc.getAssessmentPrompts({ native: 'bn', limit: 3 })
    assert.equal(limited.length, 3)
    assert.deepEqual(limited, svc.getAssessmentPrompts({ native: 'bn' }).slice(0, 3))
  })
})

describe('language pairs', () => {
  test('describe Bangla to English as cross-language', () => {
    const pair = svc.getLanguagePairProfile('bn', 'en')
    assert.ok(pair)
    assert.equal(pair.crossLanguage, true)
    assert.equal(pair.hints.length, 4)
  })

  test('English to English has hints but no cross-language anchors', () => {
    const pair = svc.getLanguagePairProfile('en', 'en')
    assert.ok(pair)
    assert.equal(pair.crossLanguage, false)
    assert.ok(pair.hints.every((hint) => hint.anchor === undefined))
  })

  test('an unresearched pair returns undefined rather than a guess', () => {
    // An invented bridge is worse than none: the caller falls back to the
    // plain target-language ordering instead of being handed a fabrication.
    assert.equal(svc.getLanguagePairProfile('klingon', 'en'), undefined)
  })

  test('every hint states that measurement overrides it', () => {
    for (const native of ['bn', 'en']) {
      const pair = svc.getLanguagePairProfile(native, 'en')
      assert.ok(pair)
      assert.match(pair.note, /not predictions|Measured results replace them/)
    }
  })

  test('hints describe sound systems, not learners', () => {
    // The rule from CLAUDE.md: a sound being absent from a first language is
    // not evidence that a speaker of it will struggle. Nothing here may
    // phrase a hint as a prediction about a person.
    const predictive =
      /\b(will|would|tend to|usually|often)\s+(struggle|find|mispronounce|substitute|fail)/i
    const deficit = /\b(lacks?|missing|cannot|unable|deficien)/i

    for (const native of ['bn', 'en']) {
      for (const hint of svc.getLanguagePairProfile(native, 'en')?.hints ?? []) {
        const text = `${hint.rationale} ${hint.anchor?.note ?? ''}`
        assert.doesNotMatch(text, predictive, `${native}/${hint.phoneme} predicts behaviour`)
        assert.doesNotMatch(text, deficit, `${native}/${hint.phoneme} frames a language as deficient`)
      }
    }
  })

  test('anchors point at real Bangla graphemes', () => {
    const anchors = (svc.getLanguagePairProfile('bn', 'en')?.hints ?? [])
      .map((hint) => hint.anchor)
      .filter((anchor) => anchor !== undefined)

    assert.equal(anchors.length, 4)
    for (const anchor of anchors) {
      // Bengali block, U+0980–U+09FF.
      assert.match(anchor.grapheme, /[ঀ-৿]/, `${anchor.grapheme} is not Bengali`)
      assert.ok(anchor.ipa.length > 0)
      assert.ok(anchor.note.length > 20)
    }
  })
})

describe('data integrity', () => {
  test('phoneme ids are unique', () => {
    const ids = ENGLISH_PHONEMES.map((p) => p.id)
    assert.equal(new Set(ids).size, ids.length)
  })

  test('every hint names a phoneme that exists', () => {
    const known = new Set(svc.getPhonemes({ assessableOnly: false }).map((p) => p.id))
    for (const native of ['bn', 'en']) {
      for (const hint of svc.getLanguagePairProfile(native, 'en')?.hints ?? []) {
        assert.ok(known.has(hint.phoneme), `hint names unknown phoneme ${hint.phoneme}`)
      }
    }
  })

  test('measurable sounds match the analyser inventory', () => {
    // Kept in step with api/app/acoustic/phonemes.py TARGETS by hand. If the
    // analyser gains a sound, this fails until the knowledge layer follows.
    assert.deepEqual(svc.getPhonemes().map((p) => p.id).sort(), ['l', 'r', 's', 'th'])
  })

  test('no learner-facing string uses clinical language', () => {
    const forbidden =
      /\b(disorder|diagnos|dyslex|patholog|impair|deficit|therapy|patient|treatment|remediation)/i

    for (const phoneme of svc.getPhonemes({ assessableOnly: false })) {
      const text = [
        phoneme.label,
        phoneme.description,
        phoneme.articulation,
        phoneme.assessmentNote ?? '',
      ].join(' ')
      assert.doesNotMatch(text, forbidden, `${phoneme.id} uses clinical language`)
    }
  })
})
