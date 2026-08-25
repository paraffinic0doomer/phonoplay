/**
 * PhonoPlay local persistence — the service layer.
 *
 * **This module is the only thing the UI imports.** Components call these
 * functions; they never touch `db.*`, a Dexie table, or IndexedDB directly.
 * Keeping that line means the storage engine is an implementation detail: the
 * schema can gain a version, a query can gain an index, and nothing in a
 * component has to know.
 *
 * Everything is local to this browser. There is no account, no server copy,
 * and no audio stored anywhere — a recording is measured and dropped.
 *
 *   settings          languages, self-assessment, learning mode
 *   phonemes          the learner model, written only from measurements
 *   syllabus          versioned plans and their items
 *   practice          sessions, attempts, contrast answers
 *   progress          derived reads over all of the above
 *   reset             resetDemoData, counts, export
 */

// ── Types ────────────────────────────────────────────────────────────
export type {
  Attempt,
  ContrastAttempt,
  ContrastProfile,
  ExerciseType,
  ItemStatus,
  LearningMode,
  Phoneme,
  PhonemeProfile,
  PracticeSession,
  SelfLevel,
  Settings,
  SkillType,
  Syllabus,
  SyllabusItem,
  SyllabusStatus,
  Trend,
} from './schema.ts'

// The database handle is exported for devtools and the reset helper only.
// Components should not need it; if one does, that is a missing service
// function rather than a reason to reach past this layer.
export {
  db,
  PhonoPlayDB,
  SETTINGS_ID,
  RECENT_SCORES_KEPT,
  STAGE_ORDER,
  migrateProfileToV2,
} from './schema.ts'

// ── Settings ─────────────────────────────────────────────────────────
export {
  DEFAULT_SETTINGS,
  completeOnboarding,
  getLearningMode,
  getSettings,
  hasOnboarded,
  setLanguages,
  setLearningMode,
  updateSettings,
} from './settings.ts'

// ── Learner model ────────────────────────────────────────────────────
export {
  MASTERY_ALPHA,
  PHONEMES,
  deriveTrend,
  getAllProfiles,
  getProfile,
  getProfilesByNeed,
  recordMeasurement,
  setContrastAccuracy,
  setStage,
} from './phonemes.ts'
export type { Measurement } from './phonemes.ts'
export {
  advanceIfReady,
  deriveConsistency,
  evaluate,
  getMastered,
} from './phonemes.ts'

// ── Progression rules ────────────────────────────────────────────────
export {
  ACCESSIBILITY_POLICY,
  STANDARD_POLICY,
  assessMastery,
  assessStage,
  ladderIndex,
  policyFor,
} from './policy.ts'
export type {
  LearnerPolicy,
  MasteryBlocker,
  MasteryVerdict,
  StageVerdict,
} from './policy.ts'

// ── Minimal pairs ────────────────────────────────────────────────────
export {
  CONTRAST_ATTENTION_BELOW,
  getContrastProfile,
  getContrastProfiles,
  getContrastsNeedingWork,
  normaliseContrast,
  recordContrastResult,
} from './contrasts.ts'

// ── Syllabus ─────────────────────────────────────────────────────────
export {
  completeItem,
  createSyllabus,
  getActivePlan,
  getActiveSyllabus,
  getItemsForPhoneme,
  getNextItem,
  getSyllabusHistory,
  getSyllabusItems,
  getSyllabusProgress,
  setItemStatus,
  skipItem,
  startItem,
} from './syllabus.ts'
export type { NewSyllabusItem } from './syllabus.ts'

// ── Practice ─────────────────────────────────────────────────────────
export {
  getAllRecentSessions,
  getAttemptsForSession,
  getContrastAccuracy,
  getContrastAttempts,
  getRecentSessions,
  getSession,
  recordContrastAttempt,
  recordPracticeAttempt,
} from './practice.ts'
export type { MeasuredAttempt } from './practice.ts'

// ── Progress ─────────────────────────────────────────────────────────
export {
  getAllProgress,
  getPhonemeProgress,
  getPracticeHistory,
  getProgressSummary,
} from './progress.ts'
export type { PhonemeProgress, ProgressPoint, ProgressSummary } from './progress.ts'

// ── Development ──────────────────────────────────────────────────────
export { exportAll, getTableCounts, resetDemoData } from './reset.ts'
