import { useCallback, useEffect, useState } from 'react'
import { ButtonLink } from '../components/Button'
import { ErrorNotice } from '../components/ErrorNotice'
import { getActivePlan } from '../db'
import type { SyllabusItem } from '../db'
import { createInitialSyllabus } from '../adaptive/syllabus'
import { PHONEME_LABEL, STAGE_LABEL } from '../practice/material'

export function Plan() {
  const [items, setItems] = useState<SyllabusItem[] | null>(null)
  const [title, setTitle] = useState('Your practice plan')
  const [reason, setReason] = useState<string | undefined>()
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      let plan = await getActivePlan()
      if (!plan) {
        await createInitialSyllabus()
        plan = await getActivePlan()
      }
      if (!plan) throw new Error('No plan was created.')
      setItems(plan.items)
      setTitle(plan.syllabus.title)
      setReason(plan.syllabus.adaptationReason)
    } catch {
      setError('Your practice plan could not be opened. Try again.')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  if (!items) return <main className="mx-auto max-w-3xl px-5 py-16">{error ? <ErrorNotice error={{ code: 'UNKNOWN', message: error, retryable: true }} onRetry={() => void load()} retryLabel="Try again" /> : <p className="label-mono text-ink-faint" aria-live="polite">Building your plan…</p>}</main>
  const next = items.find((item) => item.status === 'active' || item.status === 'pending') ?? items[0]

  return <main className="mx-auto max-w-3xl px-5 py-10 sm:py-14">
    <p className="label-mono text-ink-faint">Adaptive syllabus</p>
    <h1 className="mt-3 text-4xl font-bold tracking-tight text-ink sm:text-5xl">{title}</h1>
    {reason && <div className="mt-6 rounded-2xl border border-[var(--color-sound-s)] bg-[color-mix(in_oklab,var(--color-sound-s)_9%,var(--color-paper))] p-5"><p className="text-lg font-semibold text-ink">Your plan adapted based on your practice.</p><p className="mt-1 text-sm leading-relaxed text-ink-soft">{reason}</p></div>}
    <ol className="mt-8 space-y-3">
      {items.map((item) => <li key={item.id} className={`panel flex items-center gap-4 p-4 ${item.id === next.id ? 'border-ink' : ''}`}>
        <span className="label-mono w-12 text-ink-faint">Day {item.day}</span>
        <div className="min-w-0 flex-1"><p className="font-semibold text-ink"><span className="font-mono">{PHONEME_LABEL[item.phoneme]}</span> · {STAGE_LABEL[item.skillType]}</p><p className="mt-1 text-sm text-ink-soft">{item.learningObjective}</p></div>
        {item.id === next.id && <span className="label-mono text-ink">Next</span>}
      </li>)}
    </ol>
    <div className="mt-8"><ButtonLink to={`/practice/${next.phoneme}?lesson=${encodeURIComponent(next.id)}`} variant="sound" size="lg">Start Day {next.day}: {STAGE_LABEL[next.skillType]}</ButtonLink></div>
  </main>
}
