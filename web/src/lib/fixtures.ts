/**
 * ============================================================================
 * TEMPORARY DEVELOPMENT FIXTURES — DELETE WHEN THE BACKEND LANDS
 * ============================================================================
 *
 * These exist so the frontend can be built and navigated before the FastAPI
 * analysis service exists. Read this before using anything in this file:
 *
 *   *** NOTHING HERE ANALYSES AUDIO. ***
 *
 * `fixtureAttemptResult` ignores the recording entirely. It returns a scripted
 * sequence keyed on how many attempts you have made, so the screens can be
 * exercised end to end. It is NOT pronunciation detection, it is NOT a model,
 * and its numbers mean nothing about how anyone actually spoke.
 *
 * Every value produced here is stamped `_fixture: true`, and the UI shows a
 * persistent "Development fixture" badge whenever that flag is set. Do not
 * remove that disclosure, and do not make these numbers depend on the audio —
 * that would turn an honest placeholder into fake detection.
 *
 * Enabled only when VITE_USE_FIXTURES=true (see .env.example). It defaults to
 * true in dev and false in production builds.
 */

import type {
  AttemptResult,
  ClientAudioMeta,
  Exercise,
  Prompt,
  SoundId,
  TimelineSegment,
} from '../types/api'
import { SOUND_PROFILES } from '../data/sounds'

/** TODO(fixture): served by GET /api/prompts from api/app/data/prompts.json. */
const PROMPT_BANK: Record<SoundId, Prompt[]> = {
  s: [
    p('s_word_001', 'sun', 's', ['s', 'ʌ', 'n'], [0]),
    p('s_word_002', 'sock', 's', ['s', 'ɑ', 'k'], [0]),
    p('s_word_003', 'bus', 's', ['b', 'ʌ', 's'], [2]),
    p('s_word_004', 'grass', 's', ['g', 'ɹ', 'æ', 's'], [3]),
    p('s_word_005', 'sing', 's', ['s', 'ɪ', 'ŋ'], [0]),
    p('s_word_006', 'sick', 's', ['s', 'ɪ', 'k'], [0]),
    p('s_word_007', 'mouse', 's', ['m', 'aʊ', 's'], [2]),
  ],
  r: [
    p('r_word_001', 'rabbit', 'r', ['ɹ', 'æ', 'b', 'ɪ', 't'], [0]),
    p('r_word_002', 'red', 'r', ['ɹ', 'ɛ', 'd'], [0]),
    p('r_word_003', 'car', 'r', ['k', 'ɑ', 'ɹ'], [2]),
    p('r_word_004', 'story', 'r', ['s', 't', 'ɔ', 'ɹ', 'i'], [3]),
    p('r_word_005', 'ring', 'r', ['ɹ', 'ɪ', 'ŋ'], [0]),
    p('r_word_006', 'rake', 'r', ['ɹ', 'eɪ', 'k'], [0]),
  ],
  l: [
    p('l_word_001', 'lion', 'l', ['l', 'aɪ', 'ə', 'n'], [0]),
    p('l_word_002', 'leaf', 'l', ['l', 'i', 'f'], [0]),
    p('l_word_003', 'ball', 'l', ['b', 'ɔ', 'l'], [2]),
    p('l_word_004', 'yellow', 'l', ['j', 'ɛ', 'l', 'oʊ'], [2]),
    p('l_word_005', 'light', 'l', ['l', 'aɪ', 't'], [0]),
    p('l_word_006', 'lake', 'l', ['l', 'eɪ', 'k'], [0]),
  ],
  th: [
    p('th_word_001', 'thumb', 'th', ['θ', 'ʌ', 'm'], [0]),
    p('th_word_002', 'think', 'th', ['θ', 'ɪ', 'ŋ', 'k'], [0]),
    p('th_word_003', 'bath', 'th', ['b', 'æ', 'θ'], [2]),
    p('th_word_004', 'three', 'th', ['θ', 'ɹ', 'i'], [1]),
    p('th_word_005', 'thin', 'th', ['θ', 'ɪ', 'n'], [0]),
    p('th_word_006', 'thought', 'th', ['θ', 'ɔ', 't'], [0]),
  ],
}

const ALL_PROMPTS: Prompt[] = Object.values(PROMPT_BANK).flat()

/** TODO(fixture): replace with GET /api/prompts/{id}. */
export function fixturePromptById(id: string): Prompt | null {
  return ALL_PROMPTS.find((prompt) => prompt.id === id) ?? null
}

function p(
  id: string,
  text: string,
  target_sound: SoundId,
  phonemes: string[],
  target_indices: number[],
): Prompt {
  return {
    id,
    text,
    target_sound,
    phonemes,
    target_indices,
    level: 'word',
    difficulty: 1,
  }
}

/** TODO(fixture): replace with GET /api/prompts?sound=…&exclude=… */
export function fixturePrompt(sound: SoundId, exclude: string[] = []): Prompt {
  const bank = PROMPT_BANK[sound]
  const fresh = bank.filter((item) => !exclude.includes(item.id))
  const pool = fresh.length > 0 ? fresh : bank
  return pool[Math.floor(Math.random() * pool.length)]
}

/**
 * The scripted score sequence. Matches the walkthrough in the product brief
 * (73% → 81% → 91%) so the progress screen has a story to tell in a demo.
 * TODO(fixture): every one of these numbers comes from scoring/score.py.
 */
const SCRIPT = [
  { overall: 73, target: 68, word: 84, confidence: 0.78, verdict: 'substitution' },
  { overall: 81, target: 78, word: 88, confidence: 0.72, verdict: 'distortion' },
  { overall: 91, target: 92, word: 94, confidence: 0.85, verdict: 'on_target' },
] as const

/**
 * TODO(fixture): replace with POST /api/attempts (multipart audio upload).
 *
 * `attemptIndex` is how many attempts the learner has already completed in
 * this session. The audio is deliberately not a parameter — see the header.
 */
export function fixtureAttemptResult(
  prompt: Prompt,
  attemptIndex: number,
  /** Real, client-measured capture metadata. Echoed back, never invented. */
  source: ClientAudioMeta | null = null,
): AttemptResult {
  const profile = SOUND_PROFILES[prompt.target_sound]
  const step = SCRIPT[Math.min(attemptIndex, SCRIPT.length - 1)]
  const onTarget = step.verdict === 'on_target'
  const substituted = profile.commonlyBecomes[0]

  const targetIdx = prompt.target_indices[0] ?? 0
  const segments = buildTimeline(prompt, targetIdx, step.target / 100)
  const targetSeg = segments[targetIdx]

  return {
    attempt_id: `fixture-${prompt.id}-${attemptIndex}-${Date.now()}`,
    prompt: {
      id: prompt.id,
      text: prompt.text,
      target_sound: prompt.target_sound,
      target_ipa: profile.ipa,
    },
    audio_quality: {
      ok: true,
      // Duration is the one genuinely measured value in this fixture: it
      // comes from decoding the learner's actual recording.
      duration_s: source ? Number(source.duration_s.toFixed(2)) : 1.24,
      snr_db: 22.4,
      clipped: false,
      warnings: [],
      source,
    },
    transcript: {
      text: prompt.text,
      asr_confidence: 0.82,
      word_match: onTarget,
      normalized_edit_distance: onTarget ? 0 : 0.17,
    },
    target_analysis: {
      target_phoneme: profile.ipa,
      occurrences: [
        {
          index: targetIdx,
          start_s: targetSeg.start_s,
          end_s: targetSeg.end_s,
          gop: onTarget ? -0.21 : -1.83,
          gop_normalized: step.target / 100,
          observed_top: onTarget
            ? [
                { phoneme: profile.ipa, prob: 0.88 },
                { phoneme: substituted, prob: 0.07 },
                { phoneme: profile.commonlyBecomes[1] ?? 't', prob: 0.03 },
              ]
            : [
                { phoneme: substituted, prob: 0.61 },
                { phoneme: profile.ipa, prob: 0.24 },
                { phoneme: profile.commonlyBecomes[1] ?? 't', prob: 0.06 },
              ],
          verdict: step.verdict,
        },
      ],
    },
    phoneme_timeline: segments,
    acoustic_features: {
      f3_hz: prompt.target_sound === 'r' ? (onTarget ? 1780 : 2410) : null,
      f3_speaker_median_hz: prompt.target_sound === 'r' ? 2680 : null,
      spectral_centroid_hz:
        prompt.target_sound === 's' ? (onTarget ? 6900 : 4200) : null,
      sibilant_ratio: prompt.target_sound === 's' ? (onTarget ? 0.71 : 0.38) : null,
      target_duration_s: Number((targetSeg.end_s - targetSeg.start_s).toFixed(2)),
    },
    deviation: onTarget
      ? {
          type: 'none',
          label: null,
          from: null,
          to: null,
          confidence: step.confidence,
          evidence: ['posterior_argmax', 'transcript_match'],
          explanation: `The ${profile.display} sound landed on target.`,
        }
      : {
          type: step.verdict === 'distortion' ? 'distortion' : 'substitution',
          label:
            step.verdict === 'distortion'
              ? `${prompt.target_sound}_distortion`
              : `${prompt.target_sound}_to_${substituted}`,
          from: profile.ipa,
          to: step.verdict === 'distortion' ? profile.ipa : substituted,
          confidence: step.confidence,
          evidence:
            step.verdict === 'distortion'
              ? ['posterior_argmax', 'low_gop']
              : ['posterior_argmax', 'feature_rule', 'transcript_mismatch'],
          explanation:
            step.verdict === 'distortion'
              ? `The ${profile.display} sound was aimed at the right place but came out unclear.`
              : `The ${profile.display} sound was produced closer to /${substituted}/.`,
        },
    scores: {
      overall: step.overall,
      target_sound: step.target,
      word_accuracy: step.word,
      confidence: step.confidence,
    },
    timings_ms: { ingest: 90, asr: 610, acoustic: 420, total: 1160 },
    _fixture: true,
  }
}

/** Spreads the prompt's phonemes across a plausible duration. Display only. */
function buildTimeline(
  prompt: Prompt,
  targetIdx: number,
  targetScore: number,
): TimelineSegment[] {
  let t = 0.08
  return prompt.phonemes.map((phoneme, i) => {
    const dur = i === targetIdx ? 0.13 : 0.1 + ((i * 37) % 7) / 100
    const seg: TimelineSegment = {
      phoneme,
      start_s: Number(t.toFixed(2)),
      end_s: Number((t + dur).toFixed(2)),
      gop_normalized:
        i === targetIdx ? targetScore : 0.82 + ((i * 53) % 15) / 100,
    }
    t += dur
    return seg
  })
}

/**
 * TODO(fixture): replace with POST /api/exercises, which calls Claude via
 * api/app/llm/exercise.py and falls back to the deterministic bank.
 */
export function fixtureExercise(attempt: AttemptResult): Exercise {
  const sound = attempt.prompt.target_sound
  const profile = SOUND_PROFILES[sound]
  const to = attempt.deviation.to
  const isSub = attempt.deviation.type === 'substitution' && to && to !== profile.ipa

  // Every `id` is a real prompt in the bank above, so "practise this word"
  // always resolves to something the analysis service could score.
  const pairs: Record<SoundId, { id: string; contrast: string }[]> = {
    s: [
      { id: 's_word_005', contrast: 'thing' },
      { id: 's_word_006', contrast: 'thick' },
      { id: 's_word_007', contrast: 'mouth' },
    ],
    r: [
      { id: 'r_word_002', contrast: 'wed' },
      { id: 'r_word_005', contrast: 'wing' },
      { id: 'r_word_006', contrast: 'wake' },
    ],
    l: [
      { id: 'l_word_005', contrast: 'right' },
      { id: 'l_word_006', contrast: 'rake' },
      { id: 'l_word_002', contrast: 'reef' },
    ],
    th: [
      { id: 'th_word_005', contrast: 'fin' },
      { id: 'th_word_004', contrast: 'free' },
      { id: 'th_word_006', contrast: 'fought' },
    ],
  }

  return {
    id: `fixture-ex-${attempt.attempt_id}`,
    attempt_id: attempt.attempt_id,
    target_sound: sound,
    deviation_label: attempt.deviation.label,
    title: isSub
      ? `Tell ${profile.display} and /${to}/ apart`
      : `Sharpen your ${profile.display}`,
    cue: profile.articulation,
    activity_type: isSub ? 'minimal_pairs' : 'isolation',
    items: pairs[sound].map((pair) => {
      const prompt = fixturePromptById(pair.id)
      return {
        text: prompt?.text ?? pair.id,
        contrast: isSub ? pair.contrast : null,
        target_ipa: profile.ipa,
        prompt_id: prompt?.id ?? null,
      }
    }),
    difficulty: profile.difficulty,
    source: 'fallback',
    _fixture: true,
  }
}
