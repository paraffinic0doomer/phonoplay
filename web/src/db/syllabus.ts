import { db, newId, now } from './schema.ts'
import type { ItemStatus, Phoneme, Syllabus, SyllabusItem } from './schema.ts'

/**
 * Syllabus storage.
 *
 * A syllabus is a versioned, ordered list of items. Adapting does not edit
 * the plan in place — it supersedes it with a new version, so the history of
 * what was recommended and why survives. That matters for a product whose
 * claim is that the plan follows the measurements: being able to see the plan
 * change is the evidence.
 *
 * This module stores and reads. It does not decide what belongs in a
 * syllabus; generation lives elsewhere and hands the result here.
 */

/** What `createSyllabus` needs for each item. Ids and version are assigned. */
export type NewSyllabusItem = Omit<SyllabusItem, 'id' | 'syllabusVersion' | 'status' | 'completedAt'>

export async function getActiveSyllabus(): Promise<Syllabus | undefined> {
  return db.syllabi.where('status').equals('active').first()
}

export async function getSyllabusItems(version: number): Promise<SyllabusItem[]> {
  return db.syllabusItems
    .where('[syllabusVersion+day]')
    .between([version, 0], [version, Infinity])
    .toArray()
}

/** The active plan and its items, in day order. */
export async function getActivePlan(): Promise<{
  syllabus: Syllabus
  items: SyllabusItem[]
} | null> {
  const syllabus = await getActiveSyllabus()
  if (!syllabus) return null
  return { syllabus, items: await getSyllabusItems(syllabus.version) }
}

/**
 * Store a new syllabus and make it active, superseding any previous one.
 *
 * Written in a single transaction: a half-applied adaptation that left two
 * active plans, or none, would leave the learner with no next step.
 */
export async function createSyllabus(input: {
  title: string
  targetLanguage: string
  items: NewSyllabusItem[]
}): Promise<{ syllabus: Syllabus; items: SyllabusItem[] }> {
  return db.transaction('rw', db.syllabi, db.syllabusItems, async () => {
    const previous = await db.syllabi.orderBy('version').last()
    const version = (previous?.version ?? 0) + 1
    const timestamp = now()

    await db.syllabi.where('status').equals('active').modify({
      status: 'superseded',
      updatedAt: timestamp,
    })

    const syllabus: Syllabus = {
      id: newId(),
      version,
      title: input.title,
      targetLanguage: input.targetLanguage,
      status: 'active',
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    const items: SyllabusItem[] = input.items.map((item) => ({
      ...item,
      id: newId(),
      syllabusVersion: version,
      status: 'pending',
      completedAt: null,
    }))

    await db.syllabi.put(syllabus)
    await db.syllabusItems.bulkPut(items)
    return { syllabus, items }
  })
}

/**
 * The next thing to practise: the first item that is active, else pending, in
 * day order. Returns null when the plan is finished.
 */
export async function getNextItem(): Promise<SyllabusItem | null> {
  const plan = await getActivePlan()
  if (!plan) return null
  return (
    plan.items.find((item) => item.status === 'active') ??
    plan.items.find((item) => item.status === 'pending') ??
    null
  )
}

export async function setItemStatus(
  itemId: string,
  status: ItemStatus,
): Promise<SyllabusItem | undefined> {
  const item = await db.syllabusItems.get(itemId)
  if (!item) return undefined

  const updated: SyllabusItem = {
    ...item,
    status,
    completedAt: status === 'completed' ? now() : item.completedAt,
  }
  await db.syllabusItems.put(updated)
  return updated
}

/** Bump the attempt-free bookkeeping when a learner starts on an item. */
export async function startItem(itemId: string): Promise<SyllabusItem | undefined> {
  return setItemStatus(itemId, 'active')
}

export async function completeItem(itemId: string): Promise<SyllabusItem | undefined> {
  return setItemStatus(itemId, 'completed')
}

export async function skipItem(itemId: string): Promise<SyllabusItem | undefined> {
  return setItemStatus(itemId, 'skipped')
}

/** How far through the active plan the learner is. */
export async function getSyllabusProgress(): Promise<{
  total: number
  completed: number
  skipped: number
  remaining: number
  fraction: number
}> {
  const plan = await getActivePlan()
  if (!plan) return { total: 0, completed: 0, skipped: 0, remaining: 0, fraction: 0 }

  const total = plan.items.length
  const completed = plan.items.filter((i) => i.status === 'completed').length
  const skipped = plan.items.filter((i) => i.status === 'skipped').length

  return {
    total,
    completed,
    skipped,
    remaining: total - completed - skipped,
    // Skipped items count as settled; otherwise a skipped item would hold the
    // bar back forever and the learner could never reach 100%.
    fraction: total === 0 ? 0 : (completed + skipped) / total,
  }
}

export async function getItemsForPhoneme(phoneme: Phoneme): Promise<SyllabusItem[]> {
  const plan = await getActivePlan()
  if (!plan) return []
  return plan.items.filter((item) => item.phoneme === phoneme)
}

/** Every syllabus ever generated, newest first. The record of adaptation. */
export async function getSyllabusHistory(): Promise<Syllabus[]> {
  return (await db.syllabi.orderBy('version').toArray()).reverse()
}
