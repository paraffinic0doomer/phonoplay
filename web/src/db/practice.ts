import { db, newId, now } from './schema.ts'
import type { Attempt, ContrastAttempt, Phoneme, PracticeSession } from './schema.ts'
import { recordMeasurement } from './phonemes.ts'
import { recordContrastResult } from './contrasts.ts'
import type { Measurement } from './phonemes.ts'

/**
 * Practice records: sessions, scored attempts, and contrast answers.
 *
 * A **session** is one prompt the learner worked on. An **attempt** is one
 * recording within it — several when a learner retries, which is exactly what
 * accessibility mode's increased repetition produces.
 *
 * No recording is stored anywhere in here. The audio Blob is measured and
 * dropped; what is written is the measurement it produced.
 */

/** What the caller has after measuring a recording. */
export interface MeasuredAttempt {
  phoneme: Phoneme
  prompt: string
  /** What speech-to-text heard. Context only — never used to score. */
  transcript: string | null
  /** 0–1, or null when the analyser declined to score. */
  similarityScore: number | null
  confidence: number | null
  estimatedPhoneme: string | null
  feedbackCode: string
  assessed: boolean
  /** Recording length in seconds. */
  duration: number
}

/**
 * Store one measured recording and fold it into the learner model.
 *
 * Session, attempt, and profile update happen together: a learner should
 * never end up with an attempt that did not move their profile, or a profile
 * that moved without a record explaining why.
 *
 * The profile update is deliberately driven by `assessed`, not by whether a
 * score is present, so a future caller cannot accidentally launder a refusal
 * into the learner model by passing a zero.
 */
export async function recordPracticeAttempt(input: MeasuredAttempt): Promise<{
  session: PracticeSession
  attempt: Attempt
}> {
  const timestamp = now()

  const session: PracticeSession = {
    id: newId(),
    phoneme: input.phoneme,
    prompt: input.prompt,
    transcript: input.transcript,
    similarityScore: input.assessed ? input.similarityScore : null,
    confidence: input.assessed ? input.confidence : null,
    estimatedPhoneme: input.assessed ? input.estimatedPhoneme : null,
    feedbackCode: input.feedbackCode,
    createdAt: timestamp,
  }

  const attempt: Attempt = {
    id: newId(),
    sessionId: session.id,
    score: input.assessed ? input.similarityScore : null,
    confidence: input.assessed ? input.confidence : null,
    duration: input.duration,
    createdAt: timestamp,
  }

  await db.transaction('rw', db.practiceSessions, db.attempts, async () => {
    await db.practiceSessions.put(session)
    await db.attempts.put(attempt)
  })

  const measurement: Measurement = {
    phoneme: input.phoneme,
    similarity: input.similarityScore,
    confidence: input.confidence,
    assessed: input.assessed,
  }
  // Outside the transaction: the profile lives in another table and a failure
  // here should not roll back the record of what the learner actually did.
  await recordMeasurement(measurement)

  return { session, attempt }
}

export async function getSession(id: string): Promise<PracticeSession | undefined> {
  return db.practiceSessions.get(id)
}

export async function getAttemptsForSession(sessionId: string): Promise<Attempt[]> {
  return db.attempts.where('sessionId').equals(sessionId).sortBy('createdAt')
}

/** Recent sessions for one sound, newest first. */
export async function getRecentSessions(
  phoneme: Phoneme,
  limit = 20,
): Promise<PracticeSession[]> {
  return db.practiceSessions
    .where('phoneme')
    .equals(phoneme)
    .reverse()
    .sortBy('createdAt')
    .then((rows) => rows.slice(0, limit))
}

/** Recent sessions across every sound, newest first. */
export async function getAllRecentSessions(limit = 50): Promise<PracticeSession[]> {
  const rows = await db.practiceSessions.orderBy('createdAt').reverse().limit(limit).toArray()
  return rows
}

// ── Contrast (minimal-pair) practice ─────────────────────────────────

/**
 * Record a minimal-pair discrimination answer.
 *
 * This measures *perception* — whether the learner heard the difference —
 * and is scored by whether they picked the right option. It is not acoustic
 * analysis and is kept in its own table so the two are never averaged
 * together into one misleading number.
 */
export async function recordContrastAttempt(input: {
  contrast: string
  target: string
  response: string
  /** The phoneme this pair belongs to, so accuracy can be rolled up. */
  phoneme?: Phoneme
}): Promise<ContrastAttempt> {
  const attempt: ContrastAttempt = {
    id: newId(),
    contrast: input.contrast,
    target: input.target,
    response: input.response,
    correct: input.response === input.target,
    createdAt: now(),
  }
  await db.contrastAttempts.put(attempt)

  // Fold it into the pair's running state through the one function that owns
  // that, rather than recomputing accuracy here. Two places maintaining the
  // same aggregate is how they end up disagreeing.
  if (input.phoneme) {
    await recordContrastResult({
      contrast: input.contrast,
      phoneme: input.phoneme,
      correct: attempt.correct,
    })
  }
  return attempt
}

/** Proportion correct for one pair, or null when it has never been tried. */
export async function getContrastAccuracy(contrast: string): Promise<number | null> {
  const rows = await db.contrastAttempts.where('contrast').equals(contrast).toArray()
  if (rows.length === 0) return null
  return rows.filter((row) => row.correct).length / rows.length
}

export async function getContrastAttempts(contrast: string): Promise<ContrastAttempt[]> {
  return db.contrastAttempts.where('contrast').equals(contrast).sortBy('createdAt')
}
