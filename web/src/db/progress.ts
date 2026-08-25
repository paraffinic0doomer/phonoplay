import { db } from './schema.ts'
import type { Phoneme, PhonemeProfile, PracticeSession, Trend } from './schema.ts'
import { PHONEMES, getAllProfiles } from './phonemes.ts'
import { getSyllabusProgress } from './syllabus.ts'

/**
 * Progress: derived reads over what practice already wrote.
 *
 * Nothing here stores anything. Every figure is computed from sessions and
 * profiles at read time, so there is no second copy of the truth to drift out
 * of step with the first.
 *
 * Unassessed sessions are excluded from every series. A recording the
 * analyser declined to score is not a low point on a graph — plotting it as
 * one would show a learner getting worse because a door slammed.
 */

export interface ProgressPoint {
  /** 1-based index within this phoneme's assessed history. */
  attempt: number
  score: number
  at: string
}

export interface PhonemeProgress {
  phoneme: Phoneme
  profile: PhonemeProfile
  points: ProgressPoint[]
  /** Change from first to latest assessed score, or null with fewer than two. */
  delta: number | null
  /** Sessions the analyser declined to score. Shown as a data-quality note,
   *  never as a performance figure. */
  unassessed: number
}

/** The series for one sound, oldest first. */
export async function getPhonemeProgress(phoneme: Phoneme): Promise<PhonemeProgress> {
  const [profile] = await Promise.all([
    db.phonemeProfiles.where('phoneme').equals(phoneme).first(),
  ])
  const sessions = await db.practiceSessions
    .where('phoneme')
    .equals(phoneme)
    .sortBy('createdAt')

  const assessed = sessions.filter(isScored)
  const points: ProgressPoint[] = assessed.map((session, index) => ({
    attempt: index + 1,
    score: session.similarityScore as number,
    at: session.createdAt,
  }))

  const delta =
    points.length < 2 ? null : round(points[points.length - 1].score - points[0].score)

  return {
    phoneme,
    profile: profile ?? (await getAllProfiles()).filter((p) => p.phoneme === phoneme)[0],
    points,
    delta,
    unassessed: sessions.length - assessed.length,
  }
}

/** Every sound's series. */
export async function getAllProgress(): Promise<PhonemeProgress[]> {
  return Promise.all(PHONEMES.map(getPhonemeProgress))
}

export interface ProgressSummary {
  /** Mean mastery across phonemes that have been practised. */
  overallMastery: number
  practisedPhonemes: number
  totalSessions: number
  assessedSessions: number
  /** Sounds that need the most work, weakest first. */
  weakest: Phoneme[]
  strongest: Phoneme[]
  trends: Record<Phoneme, Trend>
  syllabus: Awaited<ReturnType<typeof getSyllabusProgress>>
  lastPractisedAt: string | null
}

/** One object with everything a dashboard needs. */
export async function getProgressSummary(): Promise<ProgressSummary> {
  const profiles = await getAllProfiles()
  const practised = profiles.filter((p) => p.attempts > 0)

  const sessions = await db.practiceSessions.toArray()
  const assessed = sessions.filter(isScored)

  const ranked = [...practised].sort((a, b) => a.masteryScore - b.masteryScore)

  const trends = Object.fromEntries(
    profiles.map((p) => [p.phoneme, p.trend]),
  ) as Record<Phoneme, Trend>

  const lastPractisedAt =
    profiles
      .map((p) => p.lastPracticed)
      .filter((value): value is string => value !== null)
      .sort()
      .pop() ?? null

  return {
    overallMastery:
      practised.length === 0
        ? 0
        : round(
            practised.reduce((sum, p) => sum + p.masteryScore, 0) / practised.length,
          ),
    practisedPhonemes: practised.length,
    totalSessions: sessions.length,
    assessedSessions: assessed.length,
    weakest: ranked.slice(0, 2).map((p) => p.phoneme),
    strongest: [...ranked].reverse().slice(0, 2).map((p) => p.phoneme),
    trends,
    syllabus: await getSyllabusProgress(),
    lastPractisedAt,
  }
}

/**
 * Practice counts per day, oldest first — the streak / consistency view.
 *
 * Days with no practice are omitted rather than zero-filled; the caller knows
 * its own date range and can fill gaps for a chart.
 */
export async function getPracticeHistory(days = 30): Promise<
  { date: string; sessions: number; assessed: number }[]
> {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
  const sessions = await db.practiceSessions
    .where('createdAt')
    .aboveOrEqual(cutoff)
    .toArray()

  const byDay = new Map<string, { sessions: number; assessed: number }>()
  for (const session of sessions) {
    const date = session.createdAt.slice(0, 10)
    const entry = byDay.get(date) ?? { sessions: 0, assessed: 0 }
    entry.sessions += 1
    if (isScored(session)) entry.assessed += 1
    byDay.set(date, entry)
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({ date, ...counts }))
}

function isScored(
  session: PracticeSession,
): session is PracticeSession & { similarityScore: number } {
  return session.similarityScore !== null
}

function round(value: number): number {
  return Math.round(value * 1e4) / 1e4
}
