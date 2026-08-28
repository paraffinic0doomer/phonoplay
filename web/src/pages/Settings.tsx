import { useEffect, useState } from 'react'
import { Button, ButtonLink } from '../components/Button'
import { ErrorNotice } from '../components/ErrorNotice'
import { getSettings, setLearningMode } from '../db'
import type { LearningMode, Settings as SettingsValue } from '../db'
import { LanguageKnowledgeService } from '../language'

const MODE_COPY: Record<LearningMode, { title: string; detail: string }> = {
  standard: {
    title: 'Standard Mode',
    detail: 'A focused path that moves from sound practice into words, phrases, and sentences.',
  },
  accessibility: {
    title: 'Accessibility Mode',
    detail: 'Smaller steps, extra repetition, and calmer feedback. The same acoustic analysis guides both modes.',
  },
}

export function Settings() {
  const [settings, setSettings] = useState<SettingsValue | null>(null)
  const [saving, setSaving] = useState<LearningMode | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void getSettings()
      .then((value) => { if (active) setSettings(value) })
      .catch(() => { if (active) setError('Your preferences could not be opened. Try again.') })
    return () => { active = false }
  }, [])

  const chooseMode = async (mode: LearningMode) => {
    if (!settings || mode === settings.learningMode || saving) return
    setSaving(mode); setError(null)
    try { setSettings(await setLearningMode(mode)) }
    catch { setError('Your learning mode could not be saved. Try again.') }
    finally { setSaving(null) }
  }

  if (!settings && !error) return <main className="mx-auto max-w-2xl px-5 py-16"><p className="label-mono text-ink-faint" aria-live="polite">Opening preferences…</p></main>
  const native = settings ? LanguageKnowledgeService.getLanguage(settings.nativeLanguage)?.name ?? settings.nativeLanguage : '—'
  const target = settings ? LanguageKnowledgeService.getLanguage(settings.targetLanguage)?.name ?? settings.targetLanguage : '—'

  return <main className="mx-auto max-w-2xl px-5 py-10 sm:py-14">
    <p className="label-mono text-ink-faint">Preferences</p>
    <h1 className="mt-3 text-4xl font-bold tracking-tight text-ink sm:text-5xl">Set your practice pace</h1>
    <p className="mt-3 max-w-xl text-lg leading-relaxed text-ink-soft">Your mode changes the size and pace of practice steps. It never changes how recordings are measured.</p>
    {error && <div className="mt-6"><ErrorNotice error={{ code: 'UNKNOWN', message: error, retryable: true }} onDismiss={() => setError(null)} onRetry={() => window.location.reload()} retryLabel="Try again" /></div>}
    {settings && <>
      <section className="panel mt-8 p-5 sm:p-6"><h2 className="label-mono text-ink-faint">Learning mode</h2><div role="radiogroup" aria-label="Learning mode" className="mt-4 space-y-3">{(['standard', 'accessibility'] as const).map((mode) => { const chosen = settings.learningMode === mode; return <button key={mode} type="button" role="radio" aria-checked={chosen} disabled={saving !== null} onClick={() => void chooseMode(mode)} className={`w-full rounded-2xl border-2 p-4 text-left transition-colors disabled:opacity-60 ${chosen ? 'border-[var(--color-sound-th)] bg-[color-mix(in_oklab,var(--color-sound-th)_9%,var(--color-paper))]' : 'border-line bg-paper hover:border-line-strong'}`}><span className="flex items-start justify-between gap-4"><span><span className="block text-lg font-semibold text-ink">{MODE_COPY[mode].title}</span><span className="mt-1 block text-sm leading-relaxed text-ink-soft">{MODE_COPY[mode].detail}</span></span><span className="label-mono shrink-0 text-ink-faint">{saving === mode ? 'Saving…' : chosen ? 'Selected' : ''}</span></span></button> })}</div><p className="mt-4 text-sm leading-relaxed text-ink-faint">Accessibility Mode may be useful for learners who benefit from additional phonological practice.</p></section>
      <section className="panel mt-5 p-5 sm:p-6"><h2 className="label-mono text-ink-faint">Languages</h2><dl className="mt-4 grid grid-cols-2 gap-4"><div><dt className="text-sm text-ink-faint">First language</dt><dd className="mt-1 font-semibold text-ink">{native}</dd></div><div><dt className="text-sm text-ink-faint">Practice language</dt><dd className="mt-1 font-semibold text-ink">{target}</dd></div></dl><div className="mt-5"><ButtonLink to="/onboarding" variant="outline">Review language choices</ButtonLink></div></section>
    </>}
    <div className="mt-8"><Button variant="ghost" onClick={() => history.back()}>Back</Button></div>
  </main>
}
