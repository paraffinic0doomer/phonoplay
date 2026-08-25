import { db } from './schema.ts'
import { freshSettings } from './settings.ts'
import { getAllProfiles } from './phonemes.ts'

/**
 * Development helpers.
 *
 * `resetDemoData()` exists so a demo can be run twice. It is destructive by
 * design and irreversible — there is no cloud copy, because there is no
 * cloud. Anything calling it from the UI should say so plainly and confirm
 * first.
 */

/**
 * Clear every table and start again from defaults.
 *
 * All eight tables are cleared in one transaction: a half-cleared database —
 * profiles wiped but a syllabus still pointing at them — is worse than either
 * a full reset or none.
 *
 * Returns the number of rows removed, which is the honest way for a caller to
 * report "cleared 42 records" rather than guessing.
 */
export async function resetDemoData(): Promise<{ cleared: number }> {
  const tables = [
    db.settings,
    db.phonemeProfiles,
    db.syllabi,
    db.syllabusItems,
    db.practiceSessions,
    db.attempts,
    db.contrastAttempts,
    db.contrastProfiles,
  ]

  const counts = await Promise.all(tables.map((table) => table.count()))
  const cleared = counts.reduce((a, b) => a + b, 0)

  await db.transaction('rw', tables, async () => {
    await Promise.all(tables.map((table) => table.clear()))
  })

  // Recreate the baseline so the app is immediately usable again rather than
  // waiting for the first read to lazily seed it.
  await db.settings.put(freshSettings())
  await getAllProfiles()

  return { cleared }
}

/**
 * Row counts per table. For a debug panel, and for confirming after a reset
 * that everything really went.
 */
export async function getTableCounts(): Promise<Record<string, number>> {
  const [
    settings,
    phonemeProfiles,
    syllabi,
    syllabusItems,
    practiceSessions,
    attempts,
    contrastAttempts,
    contrastProfiles,
  ] = await Promise.all([
    db.settings.count(),
    db.phonemeProfiles.count(),
    db.syllabi.count(),
    db.syllabusItems.count(),
    db.practiceSessions.count(),
    db.attempts.count(),
    db.contrastAttempts.count(),
    db.contrastProfiles.count(),
  ])

  return {
    settings,
    phonemeProfiles,
    syllabi,
    syllabusItems,
    practiceSessions,
    attempts,
    contrastAttempts,
    contrastProfiles,
  }
}

/**
 * Everything in the database as one object.
 *
 * The learner's data is theirs and lives only on this device, so being able
 * to take a copy of it is the least a local-only app can offer. No audio is
 * included because none is stored.
 */
export async function exportAll(): Promise<Record<string, unknown>> {
  const [
    settings,
    phonemeProfiles,
    syllabi,
    syllabusItems,
    practiceSessions,
    attempts,
    contrastAttempts,
    contrastProfiles,
  ] = await Promise.all([
    db.settings.toArray(),
    db.phonemeProfiles.toArray(),
    db.syllabi.toArray(),
    db.syllabusItems.toArray(),
    db.practiceSessions.toArray(),
    db.attempts.toArray(),
    db.contrastAttempts.toArray(),
    db.contrastProfiles.toArray(),
  ])

  return {
    exportedAt: new Date().toISOString(),
    database: 'PhonoPlayDB',
    version: 2,
    settings,
    phonemeProfiles,
    syllabi,
    syllabusItems,
    practiceSessions,
    attempts,
    contrastAttempts,
    contrastProfiles,
  }
}
