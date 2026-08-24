import { useMemo, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { SOUND_LIST, SOUND_PROFILES } from '../data/sounds'
import type { SoundId } from '../types/api'
import { useSession } from '../state/session'
import { Button, ButtonLink } from '../components/Button'
import { MouthDiagram } from '../components/MouthDiagram'

type Mode = 'hunt' | 'sprint' | 'challenge'

const HUNT_WORDS: Record<SoundId, string[]> = {
  s: ['sun', 'moon', 'sock', 'leaf'],
  r: ['rabbit', 'leaf', 'red', 'sun'],
  l: ['lion', 'rain', 'leaf', 'moon'],
  th: ['thumb', 'red', 'three', 'leaf'],
}

const CHALLENGES: Record<SoundId, string> = {
  s: 'Seven silly snakes slide slowly.',
  r: 'Red rabbits run around the road.',
  l: 'Lily likes little lemon leaves.',
  th: 'Three thin threads twist together.',
}

function ModeCard({ mode, active, title, detail, onClick }: { mode: Mode; active: boolean; title: string; detail: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`text-left transition-transform hover:-translate-y-1 ${active ? 'sound-tint-strong' : 'bg-paper'} panel p-5`}>
      <span className="label-mono text-ink-faint">{mode === 'hunt' ? '01' : mode === 'sprint' ? '02' : '03'}</span>
      <h2 className="mt-3 text-xl font-bold text-ink">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">{detail}</p>
    </button>
  )
}

export function Games() {
  const navigate = useNavigate()
  const { state, loadPrompt } = useSession()
  const [sound, setSound] = useState<SoundId>('s')
  const [mode, setMode] = useState<Mode>('hunt')
  const [startedWith, setStartedWith] = useState(state.attempts.length)
  const profile = SOUND_PROFILES[sound]
  const newAttempts = Math.max(0, state.attempts.length - startedWith)
  const huntWords = useMemo(() => HUNT_WORDS[sound], [sound])
  const sprintResults = state.attempts.slice(startedWith).filter((attempt) => attempt.targetSound === sound)
  const sprintScores = sprintResults.map((attempt) => attempt.result.scores.overall)
  const sprintAccuracy = sprintScores.length ? Math.round(sprintScores.reduce((sum, score) => sum + score, 0) / sprintScores.length) : 0
  const sprintConsistency = sprintScores.length > 1
    ? Math.max(0, Math.round(100 - Math.sqrt(sprintScores.reduce((sum, score) => sum + (score - sprintAccuracy) ** 2, 0) / sprintScores.length)))
    : 0
  const allSoundScores = state.attempts.filter((attempt) => attempt.targetSound === sound).map((attempt) => attempt.result.scores.overall)
  const beforeScore = allSoundScores[0] ?? 0
  const afterScore = allSoundScores.at(-1) ?? 0

  const beginRound = (word?: string) => {
    setStartedWith(state.attempts.length)
    const prompt = state.attempts.find((attempt) => attempt.promptText === word)?.result.prompt
    if (prompt) {
      navigate(`/practice/${sound}?prompt=${encodeURIComponent(prompt.id)}`)
      return
    }
    void loadPrompt(sound, { fresh: true })
    navigate(`/practice/${sound}`)
  }

  const resetRun = () => setStartedWith(state.attempts.length)

  return (
    <div style={{ '--sound': profile.color } as CSSProperties} className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <header className="max-w-3xl">
        <span className="label-mono text-ink-faint">Sound Lab · Play</span>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-ink sm:text-6xl">Make the target sound the game.</h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-ink-soft">Choose a mode, practise with the microphone, and build a clearer sound one real attempt at a time.</p>
      </header>

      <section className="mt-9 flex flex-wrap items-center gap-2" aria-label="Target sound">
        {SOUND_LIST.map((item) => (
          <button key={item.id} type="button" onClick={() => setSound(item.id)} className={`rounded-full px-4 py-2 font-mono text-sm font-semibold ${sound === item.id ? 'sound-bg text-white' : 'bg-paper-2 text-ink-soft'}`}>
            {item.display}
          </button>
        ))}
      </section>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <ModeCard mode="hunt" active={mode === 'hunt'} title="Sound Hunt" detail="Find the words that carry the target, then pronounce one to move the hunt forward." onClick={() => setMode('hunt')} />
        <ModeCard mode="sprint" active={mode === 'sprint'} title="Sound Sprint" detail="Work through a 30-second sequence. Watch accuracy and consistency emerge from your attempts." onClick={() => setMode('sprint')} />
        <ModeCard mode="challenge" active={mode === 'challenge'} title="Challenge Mode" detail="Take on a focused phrase built around the target sound and your current practice level." onClick={() => setMode('challenge')} />
      </div>

      <section className="panel mt-6 overflow-hidden p-0">
        <div className="sound-tint flex flex-wrap items-center justify-between gap-5 px-6 py-6 sm:px-8">
          <div className="flex items-center gap-5">
            <div className="w-20 shrink-0 sound-text"><MouthDiagram sound={sound} /></div>
            <div><span className="label-mono text-ink-faint">Target</span><h2 className="mt-1 font-mono text-4xl font-bold text-ink">{profile.display}</h2><p className="mt-1 text-sm text-ink-soft">{profile.description}</p></div>
          </div>
          <span className="label-mono text-ink-faint">{newAttempts}/3 rounds complete</span>
        </div>

        {mode === 'hunt' && <div className="px-6 py-7 sm:px-8"><h3 className="text-2xl font-bold text-ink">Which words have {profile.display}?</h3><p className="mt-2 text-sm text-ink-soft">Choose a target word to practise. The microphone decides how close the sound came.</p><div className="mt-6 grid gap-3 sm:grid-cols-2">{huntWords.map((word) => <Button key={word} variant="outline" size="lg" className="justify-start" onClick={() => beginRound(word)}>Say “{word}”</Button>)}</div></div>}

        {mode === 'sprint' && <div className="px-6 py-7 sm:px-8"><div className="flex flex-wrap items-end justify-between gap-4"><div><h3 className="text-2xl font-bold text-ink">30-second Sound Sprint</h3><p className="mt-2 max-w-xl text-sm text-ink-soft">Say three target words at a comfortable pace. Every attempt is feedback, never a penalty.</p></div><span className="rounded-full bg-paper-2 px-4 py-2 font-mono text-sm text-ink">00:30</span></div><div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3"><div><span className="label-mono block text-ink-faint">Accuracy</span><strong className="text-2xl text-ink">{sprintAccuracy}%</strong></div><div><span className="label-mono block text-ink-faint">Consistency</span><strong className="text-2xl text-ink">{sprintConsistency || '—'}{sprintConsistency ? '%' : ''}</strong></div><div><span className="label-mono block text-ink-faint">Rounds</span><strong className="text-2xl text-ink">{sprintResults.length}/3</strong></div></div><div className="mt-6 flex flex-wrap gap-3">{huntWords.slice(0, 3).map((word) => <Button key={word} variant="sound" onClick={() => beginRound(word)}>Start with “{word}”</Button>)}</div></div>}

        {mode === 'challenge' && <div className="px-6 py-7 sm:px-8"><span className="label-mono text-ink-faint">Challenge phrase</span><h3 className="mt-3 max-w-3xl text-3xl font-bold leading-tight text-ink sm:text-4xl">“{CHALLENGES[sound]}”</h3><p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-soft">Keep the highlighted sound clear at natural speed. You can return to a simpler word at any time.</p><div className="mt-6 flex flex-wrap gap-3"><Button variant="sound" size="lg" onClick={() => beginRound(huntWords[0])}>Practise the challenge</Button><Button variant="ghost" onClick={() => setMode('hunt')}>Try an easier word</Button></div></div>}
      </section>

      {newAttempts >= 3 && <section className="panel animate-rise mt-6 border-2 border-[var(--sound)] p-6 sm:p-8"><span className="label-mono sound-text">Session complete</span><h2 className="mt-2 text-4xl font-bold text-ink">Sound Mastery</h2><div className="mt-5 grid max-w-md grid-cols-2 gap-3"><div className="bg-paper-2 p-4"><span className="label-mono block text-ink-faint">Before</span><strong className="mt-1 block text-3xl text-ink">{Math.round(beforeScore)}%</strong></div><div className="sound-tint-strong p-4"><span className="label-mono block text-ink-faint">After</span><strong className="mt-1 block text-3xl text-ink">{Math.round(afterScore)}%</strong></div></div><p className="mt-4 max-w-xl text-[0.95rem] leading-relaxed text-ink-soft">Your measured target-sound score changed by {Math.round(afterScore - beforeScore)} points across the session. Keep the same cue as you move to the next level.</p><div className="mt-5 flex flex-wrap gap-3"><ButtonLink to="/progress" variant="sound">See progress</ButtonLink><Button variant="ghost" onClick={resetRun}>Play another round</Button></div></section>}
    </div>
  )
}