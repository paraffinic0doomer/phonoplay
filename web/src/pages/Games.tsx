import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { SOUND_LIST, SOUND_PROFILES } from '../data/sounds'
import type { SoundId, PronunciationMeasurement } from '../types/api'
import type { LearningMode, PhonemeProfile } from '../db'
import { getLearningMode, getProfile, recordPracticeAttempt } from '../db'
import { adaptSyllabus } from '../adaptive/syllabus'
import type { Adaptation } from '../adaptive/syllabus'
import { MAX_CLIP_MS } from '../lib/recorder'
import type { RecordingClip } from '../lib/recorder'
import { measurePronunciation } from '../lib/api'
import { useCapture } from '../state/useCapture'
import { RecordButton, useElapsed } from '../components/RecordButton'
import type { RecordStatus } from '../components/RecordButton'
import { RecordingReview } from '../components/RecordingReview'
import { ErrorNotice } from '../components/ErrorNotice'
import { Button, ButtonLink } from '../components/Button'
import { MouthDiagram } from '../components/MouthDiagram'
import { PHONEME_LABEL } from '../practice/material'

const CHALLENGES: Record<SoundId, string[]> = {
  s: ['sun', 'sock', 'sing', 'sink', 'seven'], r: ['red', 'rain', 'rabbit', 'rake', 'ring'],
  l: ['light', 'lake', 'lion', 'lace', 'leaf'], th: ['think', 'thank', 'three', 'thin', 'thumb'],
}
interface Run { assessed: boolean; similarity: number | null }
type Phase = 'ready' | 'review' | 'analysing' | 'between' | 'complete'

function Reward({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="rounded-2xl bg-paper-2 px-4 py-3"><p className="label-mono text-ink-faint">{label}</p><p className="mt-1 text-2xl font-bold tabular-nums text-ink">{value}</p><p className="mt-1 text-xs text-ink-faint">{detail}</p></div>
}

export function Games() {
  const [sound, setSound] = useState<SoundId>('th')
  const [mode, setMode] = useState<LearningMode | null>(null)
  const [challenge, setChallenge] = useState(0); const [runs, setRuns] = useState<Run[]>([])
  const [phase, setPhase] = useState<Phase>('ready'); const [clip, setClip] = useState<RecordingClip | null>(null)
  const [capturing, setCapturing] = useState(false); const [level, setLevel] = useState(0)
  const [error, setError] = useState<{ code: string; message: string; retryable: boolean } | null>(null)
  const [adaptation, setAdaptation] = useState<Adaptation | null>(null); const [profileAfter, setProfileAfter] = useState<PhonemeProfile | null>(null)
  const alive = useRef(true); const elapsed = useElapsed(capturing); const profile = SOUND_PROFILES[sound]; const word = CHALLENGES[sound][challenge]
  useEffect(() => { alive.current = true; void getLearningMode().then(setMode); return () => { alive.current = false } }, [])
  const { recorderRef, start, stop, support } = useCapture({ onRecordingStart: () => { setError(null); setCapturing(true) }, onClip: (recorded) => { setCapturing(false); setClip(recorded); setPhase('review') }, onError: (failure) => { setCapturing(false); setError(failure) } })
  useEffect(() => { if (!capturing) return; let frame = 0; const tick = () => { setLevel(recorderRef.current?.level() ?? 0); frame = requestAnimationFrame(tick) }; frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame) }, [capturing, recorderRef])
  useEffect(() => { if (!capturing) return; const id = window.setTimeout(() => void stop(), MAX_CLIP_MS); return () => window.clearTimeout(id) }, [capturing, stop])
  const reset = useCallback((nextSound = sound) => { setSound(nextSound); setChallenge(0); setRuns([]); setClip(null); setError(null); setAdaptation(null); setProfileAfter(null); setPhase('ready') }, [sound])
  const analyse = useCallback(async () => {
    if (!clip) return; setPhase('analysing'); setError(null)
    try {
      const measured: PronunciationMeasurement = await measurePronunciation({ clip, targetSound: sound, expectedText: word })
      if (!alive.current) return
      await recordPracticeAttempt({ phoneme: sound, prompt: word, transcript: null, similarityScore: measured.assessed ? measured.similarity_score : null, confidence: measured.assessed ? measured.confidence : null, estimatedPhoneme: measured.estimated_match, feedbackCode: measured.feedback_code, assessed: measured.assessed, duration: clip.durationS })
      const updated = await getProfile(sound); const nextRuns = [...runs, { assessed: measured.assessed, similarity: measured.assessed ? measured.similarity_score : null }]
      setRuns(nextRuns); setProfileAfter(updated); setClip(null)
      if (nextRuns.length === 5) { setAdaptation(await adaptSyllabus(updated)); setPhase('complete') } else setPhase('between')
    } catch (cause) { if (!alive.current) return; setError({ code: cause && typeof cause === 'object' && 'code' in cause ? String((cause as { code: unknown }).code) : 'UNKNOWN', message: cause instanceof Error ? cause.message : 'Could not measure that recording.', retryable: true }); setPhase('review') }
  }, [clip, sound, word, runs])
  const recordStatus: RecordStatus = support !== 'ok' ? 'blocked' : phase === 'analysing' ? 'processing' : phase === 'review' ? 'review' : capturing ? 'recording' : 'ready'
  const assessed = runs.filter((run) => run.assessed && run.similarity !== null).map((run) => run.similarity as number); const before = assessed[0] ?? null; const after = assessed.at(-1) ?? null; const improved = before !== null && after !== null && after > before
  if (!mode) return <main className="mx-auto max-w-3xl px-5 py-16"><p className="label-mono text-ink-faint">Preparing Sound Sprint…</p></main>
  return <main style={{ '--sound': profile.color } as CSSProperties} className="mx-auto max-w-3xl px-5 py-10 sm:py-14">
    <header><p className="label-mono text-ink-faint">Play · Sound Sprint</p><h1 className="mt-3 text-4xl font-bold tracking-tight text-ink sm:text-5xl">Five focused tries. One sound at a time.</h1><p className="mt-3 max-w-2xl text-lg leading-relaxed text-ink-soft">Every completed recording earns progress. Similarity changes what comes next; it never takes rewards away.</p></header>
    <div className="mt-7 flex flex-wrap gap-2" aria-label="Target sound">{SOUND_LIST.map((item) => <button key={item.id} type="button" onClick={() => reset(item.id)} className={`rounded-full px-4 py-2 font-mono text-sm font-semibold ${sound === item.id ? 'sound-bg text-white' : 'bg-paper-2 text-ink-soft'}`}>{item.display}</button>)}</div>
    <section className="panel mt-6 overflow-hidden p-0"><div className="sound-tint flex flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-7"><div className="flex items-center gap-4"><span className="sound-text w-18 shrink-0"><MouthDiagram sound={sound} /></span><div><p className="label-mono text-ink-faint">Target sound</p><h2 className="mt-1 font-mono text-4xl font-bold text-ink">{profile.display}</h2></div></div><span className="rounded-full bg-paper px-4 py-2 font-mono text-sm font-semibold text-ink">{Math.min(challenge + 1, 5)} / 5</span></div><div className="grid gap-3 px-5 py-5 sm:grid-cols-3 sm:px-7"><Reward label="XP" value={`${runs.length * 10} XP`} detail="10 XP for each completed try" /><Reward label="Streak" value={`${runs.length} / 5`} detail="a steady set of practice tries" /><Reward label="Mastery badge" value={runs.length === 5 ? 'Earned' : 'In progress'} detail={runs.length === 5 ? 'Five focused recordings complete' : 'Complete all five tries'} /></div></section>
    {phase !== 'complete' && <section className="panel mt-6 p-6 sm:p-7"><p className="label-mono text-ink-faint">Challenge {challenge + 1} of 5</p><p className="mt-3 font-mono text-5xl font-bold sound-text">{word}</p><p className="mt-3 text-sm leading-relaxed text-ink-soft">Say the word once at a comfortable pace. {mode === 'accessibility' ? 'There is no timer—take the space you need.' : 'This is a focused set, not a race.'}</p>{error && <div className="mt-5"><ErrorNotice error={error} onDismiss={() => setError(null)} onRetry={clip ? () => void analyse() : undefined} retryLabel="Send again" /></div>}{phase === 'review' && clip ? <div className="mt-6"><RecordingReview clip={clip} busy={false} onUse={() => void analyse()} onDiscard={() => { setClip(null); setPhase('ready') }} /></div> : phase === 'between' ? <div className="mt-7"><p className="text-lg font-semibold text-ink">Nice work—your XP is yours either way.</p><Button className="mt-4" variant="sound" size="lg" onClick={() => { setChallenge((value) => value + 1); setPhase('ready') }}>Next challenge</Button></div> : <div className="mt-8 flex flex-col items-center"><RecordButton status={recordStatus} level={capturing ? level : 0} elapsedMs={elapsed} maxMs={MAX_CLIP_MS} onStart={() => void start()} onStop={() => void stop()} /></div>}</section>}
    {phase === 'complete' && <section className="panel animate-rise mt-6 border-2 border-[var(--sound)] p-6 sm:p-8"><p className="label-mono sound-text">Session complete · Mastery badge earned</p><h2 className="mt-3 text-4xl font-bold text-ink">{improved ? 'Sound improved' : 'Five focused tries complete'}</h2><div className="mt-6 grid max-w-md grid-cols-2 gap-3"><div className="bg-paper-2 p-4"><p className="label-mono text-ink-faint">Before</p><p className="mt-1 text-3xl font-bold tabular-nums text-ink">{before === null ? '—' : `${Math.round(before * 100)}%`}</p></div><div className="sound-tint-strong p-4"><p className="label-mono text-ink-faint">After</p><p className="mt-1 text-3xl font-bold tabular-nums text-ink">{after === null ? '—' : `${Math.round(after * 100)}%`}</p></div></div><p className="mt-4 max-w-xl text-sm leading-relaxed text-ink-soft">Practice similarity is based on the recordings the analyser assessed. It is a learning measure, not a clinical score.</p>{adaptation && <div className="mt-6 rounded-2xl bg-paper-2 p-5"><p className="text-lg font-semibold text-ink">{adaptation.action === 'continue' ? 'Your next mission stays on this step.' : 'Your next mission has been updated.'}</p><p className="mt-1 text-sm leading-relaxed text-ink-soft">{adaptation.reason}</p>{profileAfter && <p className="mt-2 text-xs text-ink-faint">Current practice profile: {PHONEME_LABEL[profileAfter.phoneme]} · {profileAfter.trend} trend.</p>}</div>}<div className="mt-6 flex flex-wrap gap-3"><ButtonLink to="/plan" variant="sound">See next mission</ButtonLink><Button variant="outline" onClick={() => reset(sound)}>Play another Sound Sprint</Button></div></section>}
  </main>
}
