import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import {
  CONTRASTS,
  LAB_STEPS,
  STEP_LABEL,
  STEP_PURPOSE,
  getContrast,
  isMeasured,
  measurableSide,
  speakableContrasts,
  stepsFor,
} from './pairs.ts'
import type { Contrast } from './pairs.ts'
import {
  MEANINGFUL_TRIALS,
  accuracy,
  accuracyIsMeaningful,
  discriminationFeedback,
  productionFeedback,
  readyForNext,
  spokenTask,
  trialAt,
} from './lab.ts'
import { normaliseContrast } from '../db/contrasts.ts'

/**
 * The Sound Contrast Lab.
 *
 * Two things are load-bearing here and both are checked hard: that a pair is
 * only offered in a mode PhonoPlay can actually support, and that nothing the
 * lab says to a learner is punitive — including on the paths reached by
 * getting something wrong.
 */

const byId = (id: string): Contrast => {
  const contrast = getContrast(id)
  assert.ok(contrast, `no contrast ${id}`)
  return contrast
}

/* ── Inventory ────────────────────────────────────────────────────── */

describe('the contrast inventory', () => {
  it('offers the three MVP pairs', () => {
    assert.deepEqual(CONTRASTS.map((c) => c.id).sort(), ['f-v', 'l-r', 't-th'])
  })

  it('names each pair the way the learner model keys it', () => {
    // The id is the key written to contrastProfiles, so it has to survive
    // normalisation unchanged or the lab and the model would disagree.
    for (const contrast of CONTRASTS) {
      assert.equal(normaliseContrast(contrast.id), contrast.id, contrast.id)
    }
  })

  it('gives every pair real minimal pairs', () => {
    for (const contrast of CONTRASTS) {
      assert.ok(contrast.words.length >= 3, contrast.id)
      for (const { a, b } of contrast.words) {
        assert.notEqual(a, b)
        // A minimal pair differs in one sound, so the words stay close in
        // length. "thin/tin" yes; "thin/telephone" is not a minimal pair.
        assert.ok(Math.abs(a.length - b.length) <= 2, `${a}/${b}`)
      }
    }
  })

  it('explains what separates the two sounds, without describing people', () => {
    for (const contrast of CONTRASTS) {
      assert.ok(contrast.difference.length > 20, contrast.id)
      // Articulation, not populations.
      assert.ok(
        !/speakers|learners of|native|difficult for|struggle/i.test(contrast.difference),
        `${contrast.id}: ${contrast.difference}`,
      )
    }
  })
})

/* ── Only claiming what can be measured ───────────────────────────── */

describe('modes are limited to what the analyser supports', () => {
  it('offers speaking only where a side is a practice target', () => {
    for (const contrast of CONTRASTS) {
      const speakable = contrast.modes.includes('speak')
      assert.equal(speakable, measurableSide(contrast) !== null, contrast.id)
    }
  })

  it('supports TH/T and R/L for speaking', () => {
    assert.deepEqual(speakableContrasts().map((c) => c.id).sort(), ['l-r', 't-th'])
  })

  it('withholds speaking for F/V, and says why', () => {
    // There is no /v/ reference profile at all, and neither side is a
    // practice target. A score here would have nothing behind it, and an F/V
    // contrast that cannot detect a V said as an F misses the only thing it
    // is for.
    const fv = byId('f-v')
    assert.equal(fv.modes.includes('speak'), false)
    assert.ok(fv.speakingNote)
    assert.match(fv.speakingNote as string, /cannot measure|no reference/i)
  })

  it('stops a listening-only pair after discrimination', () => {
    assert.deepEqual(stepsFor(byId('f-v')), ['listen', 'discriminate'])
  })

  it('walks the full ladder for a speakable pair', () => {
    assert.deepEqual(stepsFor(byId('t-th')), LAB_STEPS)
    assert.deepEqual(LAB_STEPS, [
      'listen',
      'discriminate',
      'repeat',
      'minimal_pair',
      'word',
      'phrase',
      'sentence',
    ])
  })

  it('never measures perception or an isolated sound', () => {
    for (const step of ['listen', 'discriminate', 'repeat'] as const) {
      assert.equal(isMeasured(step), false, step)
    }
    for (const step of ['minimal_pair', 'word', 'phrase', 'sentence'] as const) {
      assert.equal(isMeasured(step), true, step)
    }
  })

  it('describes every step it can show', () => {
    for (const step of LAB_STEPS) {
      assert.ok(STEP_LABEL[step], step)
      assert.ok(STEP_PURPOSE[step], step)
    }
  })
})

/* ── Trials ───────────────────────────────────────────────────────── */

describe('discrimination trials', () => {
  it('plays a word that really carries the answer', () => {
    const contrast = byId('t-th')
    for (let i = 0; i < 20; i++) {
      const trial = trialAt(contrast, i)
      const expected = trial.answer === 'a' ? trial.pair.a : trial.pair.b
      assert.equal(trial.word, expected)
    }
  })

  it('uses every word before repeating one', () => {
    const contrast = byId('l-r')
    const seen = new Set<string>()
    for (let i = 0; i < contrast.words.length; i++) {
      seen.add(trialAt(contrast, i).pair.a)
    }
    assert.equal(seen.size, contrast.words.length)
  })

  it('does not let the side be predicted from the word', () => {
    // Four of the same side in a row teaches the pattern, not the sound.
    const contrast = byId('t-th')
    const answers = Array.from({ length: 16 }, (_, i) => trialAt(contrast, i).answer)
    const a = answers.filter((x) => x === 'a').length
    assert.ok(a > 4 && a < 12, `${a}/16 were side a`)

    // And the same word is not always the same side.
    const first = contrast.words[0].a
    const sides = new Set(
      Array.from({ length: 16 }, (_, i) => trialAt(contrast, i))
        .filter((t) => t.pair.a === first)
        .map((t) => t.answer),
    )
    assert.equal(sides.size, 2, 'the first pair only ever played one side')
  })
})

/* ── Spoken tasks ─────────────────────────────────────────────────── */

describe('spoken tasks', () => {
  it('asks for the side that can actually be measured', () => {
    const task = spokenTask(byId('t-th'), 'word')
    assert.ok(task)
    assert.equal(task?.side.target, 'th')
    // "thin", not "tin" — /t/ is not a practice target, so a recording of
    // "tin" would have nothing to be scored against.
    assert.equal(task?.text, 'thin')
  })

  it('returns nothing for a pair with no measurable side', () => {
    for (const step of ['word', 'phrase', 'sentence'] as const) {
      assert.equal(spokenTask(byId('f-v'), step), null, step)
    }
  })

  it('marks the isolated sound as practice, not measurement', () => {
    const task = spokenTask(byId('l-r'), 'repeat')
    assert.equal(task?.measured, false)
    assert.equal(task?.text, 'R')
  })

  it('measures words, phrases and sentences', () => {
    for (const step of ['minimal_pair', 'word', 'phrase', 'sentence'] as const) {
      assert.equal(spokenTask(byId('l-r'), step)?.measured, true, step)
    }
  })

  it('keeps the target at the start of connected speech', () => {
    // The analyser locates the target at the onset of the utterance.
    for (const contrast of speakableContrasts()) {
      const side = measurableSide(contrast)
      const expected = side?.target === 'th' ? 't' : (side?.target as string)
      for (const step of ['phrase', 'sentence'] as const) {
        const task = spokenTask(contrast, step)
        assert.equal(
          task?.text.trim().toLowerCase()[0],
          expected,
          `${contrast.id} ${step}: ${task?.text}`,
        )
      }
    }
  })
})

/* ── What the learner is told ─────────────────────────────────────── */

describe('feedback wording', () => {
  const th = byId('t-th')

  it('uses the exact words promised for a correct answer', () => {
    const message = discriminationFeedback(true, th.a)
    assert.equal(message.headline, 'Great — you identified the target sound.')
  })

  it('uses the exact words promised for a wrong one', () => {
    const message = discriminationFeedback(false, th.b)
    assert.equal(message.headline, 'Let’s hear the difference once more.')
  })

  it('offers to isolate the sound when the contrast shows up', () => {
    const message = productionFeedback({
      contrast: th,
      side: th.a,
      similarity: 0.05,
      detected: 't',
      assessed: true,
    })
    assert.equal(message.headline, 'Let’s isolate the TH sound.')
    assert.match(message.detail, /closer to the T sound/i)
  })

  it('says nothing was measured rather than inventing a low score', () => {
    const message = productionFeedback({
      contrast: th,
      side: th.a,
      similarity: null,
      detected: null,
      assessed: false,
    })
    assert.equal(message.tone, 'unmeasured')
    assert.match(message.detail, /could not be measured/i)
    assert.ok(!/\d+%/.test(message.detail))
  })

  it('is never punitive, on any path', () => {
    const messages = [
      discriminationFeedback(true, th.a),
      discriminationFeedback(false, th.b),
      readyForNext('Say a word'),
      ...[0, 0.3, 0.6, 0.9].map((similarity) =>
        productionFeedback({ contrast: th, side: th.a, similarity, detected: 'th', assessed: true }),
      ),
      productionFeedback({ contrast: th, side: th.a, similarity: 0.02, detected: 't', assessed: true }),
      productionFeedback({ contrast: th, side: th.a, similarity: null, detected: null, assessed: false }),
    ]
    for (const message of messages) {
      const text = `${message.headline} ${message.detail}`
      for (const word of [
        'fail',
        'failed',
        'wrong',
        'incorrect',
        'bad',
        'poor',
        'error',
        'mistake',
        'you missed',
        'try harder',
      ]) {
        assert.ok(
          !new RegExp(`\\b${word}\\b`, 'i').test(text),
          `"${word}" appears in: ${text}`,
        )
      }
    }
  })

  it('never uses clinical or diagnostic language', () => {
    const messages = [
      discriminationFeedback(false, th.b),
      productionFeedback({ contrast: th, side: th.a, similarity: 0.02, detected: 't', assessed: true }),
    ]
    for (const message of messages) {
      const text = `${message.headline} ${message.detail}`.toLowerCase()
      for (const term of [
        'dyslexia',
        'disorder',
        'diagnos',
        'impair',
        'therapy',
        'treatment',
        'deficit',
        'delay',
        'abnormal',
        'screening',
      ]) {
        assert.ok(!text.includes(term), `"${term}" in: ${text}`)
      }
    }
  })

  it('says what to do next, every time', () => {
    const messages = [
      discriminationFeedback(false, th.b),
      productionFeedback({ contrast: th, side: th.a, similarity: 0.3, detected: 'th', assessed: true }),
      productionFeedback({ contrast: th, side: th.a, similarity: null, detected: null, assessed: false }),
    ]
    for (const message of messages) {
      assert.ok(message.detail.length > 15, message.detail)
    }
  })
})

/* ── Accuracy ─────────────────────────────────────────────────────── */

describe('accuracy', () => {
  it('is a percentage of what was answered', () => {
    assert.equal(accuracy(3, 4), 75)
    assert.equal(accuracy(0, 4), 0)
  })

  it('is null before anything is answered, not zero', () => {
    // Nought percent and "not yet attempted" are different things, and a
    // learner opening the lab should not be met with a zero.
    assert.equal(accuracy(0, 0), null)
  })

  it('needs enough answers to mean anything', () => {
    // With two options one correct answer is a coin landing heads.
    assert.equal(accuracyIsMeaningful(1), false)
    assert.equal(accuracyIsMeaningful(MEANINGFUL_TRIALS), true)
  })
})

/* ── The row a pair writes to ─────────────────────────────────────── */

describe('contrast row identity', () => {
  it('derives the row id from the pair, so concurrent creates agree', async () => {
    // `contrast` carries a unique index. With a random id, two callers reading
    // the same pair at once both miss the read and both write, and the second
    // fails with ConstraintError. Reproduced with three concurrent reads, and
    // reached in normal use by React's double-invoked effects.
    const { getContrastProfile } = await import('../db/contrasts.ts')
    assert.equal(typeof getContrastProfile, 'function')

    // The guarantee is that the id is a pure function of the normalised key,
    // which is what makes concurrent writes idempotent.
    const source = (
      await import('node:fs')
    ).readFileSync(new URL('../db/contrasts.ts', import.meta.url), 'utf8')
    assert.match(source, /id: contrastId\(contrast\)/)
    assert.ok(!/id: newId\(\)/.test(source), 'a random id reintroduces the race')
  })
})
