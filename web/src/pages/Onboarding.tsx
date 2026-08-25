import { useEffect, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { completeOnboarding, getSettings, hasOnboarded } from '../db'
import type { LearningMode, SelfLevel } from '../db'
import { LanguageKnowledgeService } from '../language'
import {
  GOAL_CHOICES,
  LEVEL_CHOICES,
  MODE_CHOICES,
  MODE_NOTE,
  OTHER,
  STEP_COUNT,
  STEP_TITLES,
  nativeLanguageChoices,
  targetLanguageChoices,
} from '../onboarding/questions'
import type { LearningGoal } from '../onboarding/questions'
import { ChoiceCard, StepFrame } from '../components/OnboardingStep'
import { Button } from '../components/Button'

/**
 * Onboarding.
 *
 * Five questions, one per screen, and no account at the end of them. Nothing
 * asked here is required for the app to work — a learner who never opens this
 * screen still gets working defaults — so it is framed as the start of a
 * journey rather than a gate in front of one.
 *
 * Answers are written to IndexedDB in a single call at the end. Writing each
 * step as it happens would leave a half-configured profile behind if someone
 * closes the tab midway, which is worse than losing four taps.
 */
export function Onboarding() {
  const navigate = useNavigate()

  const [step, setStep] = useState(1)
  const [nativeChoice, setNativeChoice] = useState<string>('')
  const [otherLanguage, setOtherLanguage] = useState('')
  const [targetLanguage, setTargetLanguage] = useState('en')
  const [level, setLevel] = useState<SelfLevel | ''>('')
  const [goal, setGoal] = useState<LearningGoal | ''>('')
  const [mode, setMode] = useState<LearningMode | ''>('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const natives = nativeLanguageChoices()
  const targets = targetLanguageChoices()

  // Re-running onboarding shows the current answers; arriving for the first
  // time shows none. Without the `hasOnboarded` gate the defaults prefilled
  // step 1 with English, so a new learner met a question that was already
  // answered for them.
  useEffect(() => {
    let cancelled = false
    void Promise.all([hasOnboarded(), getSettings()]).then(([onboarded, settings]) => {
      if (cancelled || !onboarded) return
      const known = LanguageKnowledgeService.getLanguage(settings.nativeLanguage)
      if (known) {
        setNativeChoice(known.code)
      } else if (settings.nativeLanguage && settings.nativeLanguage !== 'en') {
        // A hand-typed language from a previous run.
        setNativeChoice(OTHER)
        setOtherLanguage(settings.nativeLanguage)
      }
      setTargetLanguage(settings.targetLanguage || 'en')
      setLevel(settings.level)
      if (settings.learningGoal) setGoal(settings.learningGoal as LearningGoal)
      setMode(settings.learningMode)
    })
    return () => {
      cancelled = true
    }
  }, [])

  /** Whether the current step has an answer good enough to move on. */
  const canAdvance = (() => {
    switch (step) {
      case 1:
        return nativeChoice === OTHER
          ? otherLanguage.trim().length > 0
          : nativeChoice !== ''
      case 2:
        return targetLanguage !== ''
      case 3:
        return level !== ''
      case 4:
        return goal !== ''
      case 5:
        return mode !== ''
      default:
        return true
    }
  })()

  async function finish() {
    setSaving(true)
    setError(null)
    try {
      await completeOnboarding({
        // "Other" stores exactly what was typed. Lookups then miss, and the
        // learner gets the plain English ordering instead of an invented
        // bridge — see language/languages.ts.
        nativeLanguage:
          nativeChoice === OTHER ? otherLanguage.trim() : nativeChoice || 'en',
        targetLanguage,
        level: (level || 'beginner') as SelfLevel,
        learningGoal: goal || 'general',
        learningMode: (mode || 'standard') as LearningMode,
      })
      setStep(STEP_COUNT + 1)
    } catch {
      setError('Could not save your answers. Try again.')
    } finally {
      setSaving(false)
    }
  }

  const back = (
    <Button
      variant="ghost"
      onClick={() => (step === 1 ? navigate('/') : setStep((s) => s - 1))}
    >
      Back
    </Button>
  )

  const next = (label = 'Continue') => (
    <Button
      variant="sound"
      size="lg"
      disabled={!canAdvance || saving}
      onClick={() => (step === STEP_COUNT ? void finish() : setStep((s) => s + 1))}
    >
      {saving ? 'Saving…' : label}
    </Button>
  )

  const selectedNative = LanguageKnowledgeService.getLanguage(nativeChoice)

  return (
    <main
      // The accent follows the sound the learner will meet first, so the flow
      // already looks like the product rather than a settings page.
      style={{ '--sound': 'var(--color-sound-th)' } as CSSProperties}
      className="mx-auto max-w-2xl px-5 py-8 sm:py-12"
    >
      {error && (
        <p role="alert" className="mb-4 rounded-2xl bg-bad/10 p-4 text-sm text-bad">
          {error}
        </p>
      )}

      {/* ── 1. First language ─────────────────────────────────── */}
      {step === 1 && (
        <StepFrame
          step={1}
          total={STEP_COUNT}
          title={STEP_TITLES[0]}
          subtitle="We use this to pick a familiar sound to start from, where there is one."
          footer={
            <>
              {back}
              {next()}
            </>
          }
        >
          <div role="radiogroup" aria-label={STEP_TITLES[0]} className="flex flex-col gap-3">
            {natives.map((choice) => (
              <ChoiceCard
                key={choice.value}
                choice={choice}
                selected={nativeChoice === choice.value}
                onSelect={setNativeChoice}
              />
            ))}
          </div>

          {nativeChoice === OTHER && (
            <div className="animate-rise mt-4">
              <label
                htmlFor="other-language"
                className="label-mono block text-ink-faint"
              >
                Which language?
              </label>
              <input
                id="other-language"
                value={otherLanguage}
                onChange={(event) => setOtherLanguage(event.target.value)}
                autoComplete="off"
                placeholder="e.g. Tagalog"
                className="mt-2 w-full rounded-2xl border-2 border-line bg-paper px-4 py-3 text-lg text-ink outline-none focus:border-[var(--sound)]"
              />
              {/* Said here rather than after they commit: PhonoPlay measures
                  English sounds, and a learner choosing an unlisted language
                  should know that before answering four more questions. */}
              <p className="mt-3 rounded-2xl bg-paper-2 p-4 text-sm leading-relaxed text-ink-soft">
                PhonoPlay&rsquo;s pronunciation engine focuses on{' '}
                <strong className="font-semibold text-ink">English</strong>. You can
                still practise every sound — we just won&rsquo;t have a familiar
                starting sound from your language to build on yet.
              </p>
            </div>
          )}

          {selectedNative?.targetNote && (
            <p className="mt-4 rounded-2xl bg-paper-2 p-4 text-sm leading-relaxed text-ink-soft">
              {selectedNative.targetNote}
            </p>
          )}
        </StepFrame>
      )}

      {/* ── 2. Target language ────────────────────────────────── */}
      {step === 2 && (
        <StepFrame
          step={2}
          total={STEP_COUNT}
          title={STEP_TITLES[1]}
          subtitle="English is the only language PhonoPlay can measure today. More will need their own reference recordings."
          footer={
            <>
              {back}
              {next()}
            </>
          }
        >
          <div role="radiogroup" aria-label={STEP_TITLES[1]} className="flex flex-col gap-3">
            {targets.map((choice) => (
              <ChoiceCard
                key={choice.value}
                choice={choice}
                selected={targetLanguage === choice.value}
                onSelect={setTargetLanguage}
              />
            ))}
          </div>
        </StepFrame>
      )}

      {/* ── 3. Comfort ────────────────────────────────────────── */}
      {step === 3 && (
        <StepFrame
          step={3}
          total={STEP_COUNT}
          title={STEP_TITLES[2]}
          subtitle="A starting point only. Your recordings decide what you actually practise."
          footer={
            <>
              {back}
              {next()}
            </>
          }
        >
          <div role="radiogroup" aria-label={STEP_TITLES[2]} className="flex flex-col gap-3">
            {LEVEL_CHOICES.map((choice) => (
              <ChoiceCard
                key={choice.value}
                choice={choice}
                selected={level === choice.value}
                onSelect={setLevel}
              />
            ))}
          </div>
        </StepFrame>
      )}

      {/* ── 4. Reason ─────────────────────────────────────────── */}
      {step === 4 && (
        <StepFrame
          step={4}
          total={STEP_COUNT}
          title={STEP_TITLES[3]}
          subtitle="This shapes the words and phrases you practise with."
          footer={
            <>
              {back}
              {next()}
            </>
          }
        >
          <div role="radiogroup" aria-label={STEP_TITLES[3]} className="flex flex-col gap-3">
            {GOAL_CHOICES.map((choice) => (
              <ChoiceCard
                key={choice.value}
                choice={choice}
                selected={goal === choice.value}
                onSelect={setGoal}
              />
            ))}
          </div>
        </StepFrame>
      )}

      {/* ── 5. Mode ───────────────────────────────────────────── */}
      {step === 5 && (
        <StepFrame
          step={5}
          total={STEP_COUNT}
          title={STEP_TITLES[4]}
          subtitle="Both modes use the same pronunciation analysis. They differ in how big the steps are."
          footer={
            <>
              {back}
              {next('Finish')}
            </>
          }
        >
          <div role="radiogroup" aria-label={STEP_TITLES[4]} className="flex flex-col gap-3">
            {MODE_CHOICES.map((choice) => (
              <ChoiceCard
                key={choice.value}
                choice={choice}
                selected={mode === choice.value}
                onSelect={setMode}
              />
            ))}
          </div>
          <p className="mt-4 rounded-2xl bg-paper-2 p-4 text-sm leading-relaxed text-ink-soft">
            {MODE_NOTE}
          </p>
        </StepFrame>
      )}

      {/* ── Done ──────────────────────────────────────────────── */}
      {step > STEP_COUNT && (
        <div className="animate-rise flex min-h-[calc(100dvh-8rem)] flex-col justify-center py-10 text-center">
          <p className="label-mono text-ink-faint">You&rsquo;re set up</p>
          <h1 className="mx-auto mt-4 max-w-lg text-4xl font-bold leading-tight tracking-tight text-ink sm:text-5xl">
            Let&rsquo;s build your pronunciation profile.
          </h1>
          <p className="mx-auto mt-5 max-w-md text-lg leading-relaxed text-ink-soft">
            A few short recordings, one sound at a time. What you say decides
            what you practise next — nothing is assumed from your answers.
          </p>

          <div className="mt-9 flex justify-center">
            <Button variant="sound" size="lg" onClick={() => navigate('/assessment')}>
              Start Assessment
            </Button>
          </div>

          <button
            type="button"
            onClick={() => setStep(1)}
            className="label-mono mx-auto mt-6 text-ink-faint underline underline-offset-2 hover:text-ink"
          >
            Change my answers
          </button>
        </div>
      )}
    </main>
  )
}
