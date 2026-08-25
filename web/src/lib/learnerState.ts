import type { AttemptResult, SoundId } from '../types/api'

export type LearnerTrend = 'improving' | 'stable' | 'declining' | 'inconsistent'
export type RecommendedDifficulty =
  | 'isolated_sound'
  | 'simple_words'
  | 'multisyllabic_words'
  | 'short_phrases'
  | 'sentences_speed_variation'

export interface LearnerState {
  phoneme: SoundId
  mastery: number
  confidence: number
  attempt_count: number
  recent_scores: number[]
  trend: LearnerTrend
  recommended_difficulty: RecommendedDifficulty
  common_feedback_codes: string[]
}

const bands: Array<[number, RecommendedDifficulty]> = [
  [60, 'isolated_sound'],
  [75, 'simple_words'],
  [85, 'multisyllabic_words'],
  [92, 'short_phrases'],
  [101, 'sentences_speed_variation'],
]

export function learnerState(sound: SoundId, results: AttemptResult[]): LearnerState {
  // Only attempts the acoustic stage actually scored. An unassessed result
  // still carries a similarity number, but folding it into mastery would let
  // a recording we declined to judge move the learner's level.
  const scores = results
    .filter((result) => result.assessed !== false)
    .map((result) => result.scores.overall)
  const recent = scores.slice(-5)
  const mastery = recent.length ? recent.reduce((sum, score) => sum + score, 0) / recent.length : 0
  const average = recent.length ? mastery : 0
  const deviation = recent.length > 1
    ? Math.sqrt(recent.reduce((sum, score) => sum + (score - average) ** 2, 0) / recent.length)
    : 0
  const slope = recent.length > 1 ? (recent[recent.length - 1] - recent[0]) / (recent.length - 1) : 0
  const trend: LearnerTrend = deviation >= 12 ? 'inconsistent' : slope >= 4 ? 'improving' : slope <= -4 ? 'declining' : 'stable'
  const feedback = results.flatMap((result) => result.deviation ? [result.deviation.type] : [])
  const common = [...new Set(feedback)].sort((a, b) => feedback.filter((code) => code === b).length - feedback.filter((code) => code === a).length).slice(0, 3)
  return {
    phoneme: sound,
    mastery: Math.round(mastery * 10) / 10,
    confidence: Math.round(Math.min(1, recent.length / 5) * Math.max(0, 1 - deviation / 25) * 100) / 100,
    attempt_count: scores.length,
    recent_scores: recent,
    trend,
    recommended_difficulty: bands.find(([ceiling]) => mastery < ceiling)?.[1] ?? 'sentences_speed_variation',
    common_feedback_codes: common,
  }
}