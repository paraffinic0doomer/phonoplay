import Dexie, { type EntityTable } from 'dexie'

/**
 * PhonoPlayDB — the whole persistence layer.
 *
 * Single-user, on-device, no account. Everything a learner does lives in
 * their own browser and never leaves it; the server measures audio and
 * generates text, and remembers nothing. Opening the app works immediately
 * because there is nothing to sign into.
 *
 * ## No audio, ever
 *
 * There is deliberately no field on any table that could hold a recording.
 * A recording exists as an in-memory Blob for exactly as long as it takes to
 * measure it, and is then dropped. The guarantee is structural rather than a
 * convention: adding audio storage would require adding a field here, which
 * is a visible change someone has to make on purpose.
 *
 * ## Time
 *
 * Timestamps are ISO 8601 strings, not `Date`. They sort correctly as index
 * keys, survive `structuredClone` without surprises, are readable in
 * devtools, and match the format the API already speaks.
 */

// ── Shared vocabulary ────────────────────────────────────────────────

/** The MVP target sounds. Mirrors `TARGETS` in api/app/acoustic/phonemes.py. */
export type Phoneme = 's' | 'r' | 'l' | 'th'

/**
 * Standard runs the normal ladder. Accessibility takes smaller steps, adds a
 * minimal-pair level, repeats more, and advances more slowly.
 *
 * It is a learning strategy, not a category of learner: nothing here records
 * or infers anything about a person, and the mode can be changed at any time.
 */
export type LearningMode = 'standard' | 'accessibility'

/** Self-reported at onboarding. Never used to gate content. */
export type SelfLevel = 'beginner' | 'intermediate' | 'advanced'

/** Where a learner sits on the ladder for one sound. */
/**
 * The practice ladder, easiest first.
 *
 * `sound` is the isolated phoneme. `syllable` sits between it and a whole
 * word because CLAUDE.md's Accessibility Mode progression needs that rung -
 * the learner model supports every stage the product can ask for, and a mode
 * that wants smaller steps needs somewhere smaller to step.
 */
export type SkillType =
  | 'sound'
  | 'syllable'
  | 'word'
  | 'minimal_pair'
  | 'phrase'
  | 'sentence'

/** The ladder in order. Advancing means moving one rung along this. */
export const STAGE_ORDER: SkillType[] = [
  'sound',
  'syllable',
  'word',
  'minimal_pair',
  'phrase',
  'sentence',
]

export type ExerciseType =
  | 'production'
  | 'contrast'
  | 'repetition'
  | 'discrimination'

export type ItemStatus = 'pending' | 'active' | 'completed' | 'skipped'
export type SyllabusStatus = 'active' | 'superseded'

/**
 * Direction of travel over the recent window.
 *
 * `new` is not a direction - it means fewer than three assessed attempts, so
 * there is nothing to take a direction from. Reporting `stable` there would
 * claim a steadiness nobody has observed.
 */
export type Trend = 'improving' | 'stable' | 'declining' | 'inconsistent' | 'new'

// ── Tables ───────────────────────────────────────────────────────────

/**
 * One row, always. `SETTINGS_ID` is a constant rather than an autoincrement
 * key so reads never have to ask "which settings?".
 */
export interface Settings {
  id: string
  nativeLanguage: string
  targetLanguage: string
  level: SelfLevel
  /** Free text from onboarding, e.g. "sound clearer at work". */
  learningGoal: string
  learningMode: LearningMode
  createdAt: string
  updatedAt: string
}

/**
 * The learner model: one row per phoneme.
 *
 * **Written only from acoustic measurements.** No language model contributes
 * to any field here. Generated exercise text is content; these are evidence,
 * and the two must not mix.
 */
export interface PhonemeProfile {
  id: string
  phoneme: Phoneme
  /** 0–1, exponentially weighted over assessed attempts. */
  masteryScore: number
  /** 0–1. How much the measurements themselves are worth, not how good the
   *  learner is — a mean of the analyser's own confidence. */
  confidence: number
  /** Assessed attempts only. Refusals are counted on the session, not here. */
  attempts: number
  /** Most recent assessed similarities, newest last. Bounded. */
  recentScores: number[]
  trend: Trend
  /**
   * 0-1. How closely the recent scores agree with each other, independent of
   * how high they are. A learner scoring 0.4 every time is highly consistent
   * and not yet accurate; one alternating 0.2 and 0.9 is neither.
   *
   * 0 until there are at least two assessed attempts - no spread can be
   * measured from a single point, and 1 ("perfectly consistent") would be a
   * claim made from nothing.
   */
  consistency: number
  currentStage: SkillType
  /** Attempts at the current stage. Accessibility mode requires more. */
  repetitionCount: number
  /** 0–1 over contrast exercises for this sound, or null if none attempted. */
  contrastAccuracy: number | null
  lastPracticed: string | null
  updatedAt: string
}

export interface Syllabus {
  id: string
  version: number
  title: string
  targetLanguage: string
  status: SyllabusStatus
  createdAt: string
  updatedAt: string
}

export interface SyllabusItem {
  id: string
  syllabusVersion: number
  /** 1-based day within the plan. */
  day: number
  phoneme: Phoneme
  skillType: SkillType
  exerciseType: ExerciseType
  /** 1–5. */
  difficulty: number
  /** What the learner says. Exactly what gets measured. */
  prompt: string
  learningObjective: string
  /** Mastery (0–1) this item needs before it counts as complete. */
  masteryRequirement: number
  status: ItemStatus
  completedAt: string | null
}

/**
 * One recording, measured.
 *
 * `transcript` holds what speech-to-text heard. It is stored because it is
 * useful context on the learner's own device, and because it is theirs — but
 * it is never evidence about pronunciation, and nothing reads it to compute a
 * score. `resetDemoData()` clears it along with everything else.
 */
export interface PracticeSession {
  id: string
  phoneme: Phoneme
  prompt: string
  transcript: string | null
  /** 0–1, or null when the analyser declined to score. */
  similarityScore: number | null
  confidence: number | null
  /** What the sound actually measured as. Null when unassessed. */
  estimatedPhoneme: string | null
  feedbackCode: string
  createdAt: string
}

/**
 * A scored try within a session.
 *
 * Kept separate from the session so a single prompt can hold several tries —
 * which is what accessibility mode's increased repetition needs.
 */
export interface Attempt {
  id: string
  sessionId: string
  /** 0–1. Null when the attempt was not assessed. */
  score: number | null
  confidence: number | null
  /** Recording length in seconds. */
  duration: number
  createdAt: string
}

/**
 * A minimal-pair discrimination answer — "did you hear SIP or SHIP?".
 *
 * This is perception, not production, and it is measured by whether the
 * learner picked the right option, not by any acoustic analysis.
 */
/**
 * Running state for one minimal pair, e.g. "s-th".
 *
 * Separate from PhonemeProfile because a sound belongs to several pairs and
 * they can go differently: someone may separate /r/ from /w/ reliably while
 * still confusing /r/ with /l/. Rolling them into one number per sound would
 * hide exactly the distinction that decides what to practise.
 */
export interface ContrastProfile {
  id: string
  /** The pair, normalised so "s-th" and "th-s" are the same row. */
  contrast: string
  /** The sound this pair is practised for. */
  phoneme: Phoneme
  attempts: number
  correctAttempts: number
  /** correctAttempts / attempts, or null before anything was attempted. */
  accuracy: number | null
  /** Most recent outcomes as 1 or 0, newest last. Bounded. */
  recentResults: number[]
  trend: Trend
  lastPracticed: string | null
  updatedAt: string
}

export interface ContrastAttempt {
  id: string
  /** The pair practised, e.g. "s-th". */
  contrast: string
  /** The sound that was actually played or asked for. */
  target: string
  /** What the learner chose. */
  response: string
  correct: boolean
  createdAt: string
}

// ── Database ─────────────────────────────────────────────────────────

export const SETTINGS_ID = 'settings'

/** Most recent scores kept per phoneme. Enough for a trend, bounded so a row
 *  cannot grow without limit over a long session. */
export const RECENT_SCORES_KEPT = 10

export class PhonoPlayDB extends Dexie {
  settings!: EntityTable<Settings, 'id'>
  phonemeProfiles!: EntityTable<PhonemeProfile, 'id'>
  syllabi!: EntityTable<Syllabus, 'id'>
  syllabusItems!: EntityTable<SyllabusItem, 'id'>
  practiceSessions!: EntityTable<PracticeSession, 'id'>
  attempts!: EntityTable<Attempt, 'id'>
  contrastAttempts!: EntityTable<ContrastAttempt, 'id'>
  contrastProfiles!: EntityTable<ContrastProfile, 'id'>

  constructor() {
    super('PhonoPlayDB')

    // Only indexed fields are listed; everything else on an interface is
    // stored but not indexed. `&` marks a unique index.
    this.version(1).stores({
      settings: 'id',
      // One profile per phoneme, enforced by the database rather than by
      // remembering to check.
      phonemeProfiles: 'id, &phoneme, updatedAt',
      syllabi: 'id, version, status',
      // Compound index because the common read is "this version, in day
      // order".
      syllabusItems:
        'id, syllabusVersion, phoneme, status, [syllabusVersion+day], [syllabusVersion+status]',
      practiceSessions: 'id, phoneme, createdAt, [phoneme+createdAt]',
      attempts: 'id, sessionId, createdAt',
      contrastAttempts: 'id, contrast, target, createdAt',
    })

    // v2 adds the per-pair aggregate and `consistency` on phoneme profiles.
    // Dexie only needs the new store declared; the upgrade backfills the new
    // field so no reader has to cope with it being undefined.
    this.version(2)
      .stores({
        contrastProfiles: 'id, &contrast, phoneme, updatedAt',
      })
      .upgrade(async (transaction) => {
        await transaction
          .table('phonemeProfiles')
          .toCollection()
          .modify(migrateProfileToV2)
      })
  }
}

/**
 * Bring one v1 phoneme profile up to v2, in place.
 *
 * Named and exported rather than written inline in the upgrade callback so it
 * can be tested directly. A migration is run once per learner, on data that
 * already exists and cannot be regenerated, which makes it the worst possible
 * place for an untested branch.
 */
export function migrateProfileToV2(profile: Record<string, unknown>): void {
  // Added in v2. Absent, not zero, on every v1 row.
  if (typeof profile.consistency !== 'number') profile.consistency = 0
  // v1 called the first rung "isolated" and a flat trend "steady".
  if (profile.currentStage === 'isolated') profile.currentStage = 'sound'
  if (profile.trend === 'steady') profile.trend = 'stable'
}

/** The single connection. Dexie opens lazily on first use. */
export const db = new PhonoPlayDB()

// ── Small shared helpers ─────────────────────────────────────────────

export function now(): string {
  return new Date().toISOString()
}

/**
 * A unique id.
 *
 * `crypto.randomUUID` needs a secure context; the fallback keeps the app
 * working over plain http on a LAN address, which is how a phone usually
 * reaches a dev machine.
 */
export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
