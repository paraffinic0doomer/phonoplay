import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { SOUND_PROFILES, isSoundId } from '../data/sounds'
import { useSession } from '../state/session'
import { useCapture } from '../state/useCapture'
import { MAX_CLIP_MS } from '../lib/recorder'
import { Button, ButtonLink } from '../components/Button'
import { RecordButton, useElapsed } from '../components/RecordButton'
import type { RecordStatus } from '../components/RecordButton'
import { RecordingReview } from '../components/RecordingReview'
import { WaveField } from '../components/WaveField'
import { MouthDiagram } from '../components/MouthDiagram'
import { Stepper } from '../components/Stepper'
import { ErrorNotice } from '../components/ErrorNotice'

export function Practice() {
  const { sound } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const {
    state,
    selectSound,
    loadPrompt,
    beginPermissionRequest,
    recordingStarted,
    clipCaptured,
    discardClip,
    uploadClip,
    setMicPermission,
    reportError,
    clearError,
    resetFlow,
  } = useSession()

  const [level, setLevel] = useState(0)
  const elapsed = useElapsed(state.status === 'recording')

  const valid = isSoundId(sound)
  const requestedPromptId = searchParams.get('prompt')

  // One owner for the device. Journey uses the same hook, so both screens
  // report identical codes and messages for identical failures.
  const { recorderRef, start, stop, support } = useCapture({
    onPermissionRequest: beginPermissionRequest,
    onRecordingStart: recordingStarted,
    onClip: clipCaptured,
    onError: reportError,
    onPermissionChange: setMicPermission,
  })

  /* Keep session state in step with the URL. */
  useEffect(() => {
    if (valid && state.targetSound !== sound) selectSound(sound)
  }, [valid, sound, state.targetSound, selectSound])

  /* Load a prompt whenever we do not have the right one on screen. */
  useEffect(() => {
    if (!valid) return
    const promptMatches =
      state.prompt?.target_sound === sound &&
      (!requestedPromptId || state.prompt.id === requestedPromptId)

    if (promptMatches) {
      // Coming back to practise the same word after a finished attempt: the
      // prompt needs no reload, but the recorder must be re-armed or the mic
      // button stays stuck in its success state.
      if (state.status === 'success') resetFlow()
      return
    }
    if (state.status === 'loading-prompt') return
    void loadPrompt(sound, { promptId: requestedPromptId ?? undefined })
  }, [valid, sound, requestedPromptId, state.prompt, state.status, loadPrompt, resetFlow])

  /*
   * Recover a stranded capture state.
   *
   * The session reducer outlives this screen, so a status of `recording` or
   * `requesting-permission` can survive a navigation while the recorder that
   * backed it cannot. That left the button showing "stop" with nothing behind
   * it — pressing it did nothing, and there was no way back to `ready`.
   */
  const recovered = useRef(false)
  useEffect(() => {
    // Once, on first mount. A fresh mount never has a live recorder behind
    // it, so a mid-capture status here is stale by definition. The guard —
    // rather than an empty dependency list — keeps this from firing during a
    // real recording, without suppressing the dependency check.
    if (recovered.current) return
    recovered.current = true
    if (state.status === 'recording' || state.status === 'requesting-permission') {
      resetFlow()
    }
  }, [state.status, resetFlow])

  /* Poll the real input level while recording. */
  useEffect(() => {
    if (state.status !== 'recording') {
      setLevel(0)
      return
    }
    let frame = 0
    const tick = () => {
      setLevel(recorderRef.current?.level() ?? 0)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [state.status, recorderRef])

  const handleStop = stop

  const handleStart = useCallback(async () => {
    clearError()
    await start()
  }, [clearError, start])

  /* Hard cap on clip length. */
  useEffect(() => {
    if (state.status !== 'recording') return
    const id = window.setTimeout(() => void stop(), MAX_CLIP_MS)
    return () => window.clearTimeout(id)
  }, [state.status, stop])

  const handleUpload = useCallback(async () => {
    const stored = await uploadClip()
    if (stored) navigate('/results')
  }, [uploadClip, navigate])

  /* "R" toggles recording, unless the learner is typing. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'r' || event.metaKey || event.ctrlKey) return
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (state.status === 'recording') {
        event.preventDefault()
        void handleStop()
      } else if (state.status === 'ready') {
        event.preventDefault()
        void handleStart()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [state.status, handleStart, handleStop])

  if (!valid) return <Navigate to="/sounds" replace />

  const profile = SOUND_PROFILES[sound]
  const prompt = state.prompt
  const { status, clip } = state
  const loading = status === 'loading-prompt' || (!prompt && !state.error)
  const recording = status === 'recording'
  const processing = status === 'processing'
  const reviewing = status === 'review' || (status === 'error' && clip !== null)

  const recordStatus: RecordStatus =
    support !== 'ok'
      ? 'blocked'
      : status === 'loading-prompt' || status === 'idle'
        ? 'idle'
        : status === 'error' && !clip
          ? 'error'
          : reviewing
            ? 'review'
            : (status as RecordStatus)

  /** Announced to screen readers on every state change. */
  const liveMessage = processing
    ? 'Analyzing your sound'
    : recording
      ? 'Recording'
      : status === 'requesting-permission'
        ? 'Waiting for microphone permission'
        : reviewing
          ? 'Recording captured. Listen back, then choose whether to send it.'
          : loading
            ? 'Loading a word'
            : prompt
              ? `Ready to record the word ${prompt.text}`
              : ''

  return (
    <div
      style={{ '--sound': profile.color } as CSSProperties}
      className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Stepper current="Record" />
        <ButtonLink to="/sounds" variant="ghost" size="sm">
          Change sound
        </ButtonLink>
      </div>

      <p aria-live="polite" className="sr-only">
        {liveMessage}
      </p>

      <section className="panel mt-6 overflow-hidden p-0">
        {/* Target sound header */}
        <div className="sound-tint flex items-center justify-between gap-4 px-6 py-5 sm:px-8">
          <div>
            <span className="label-mono text-ink-faint">Target sound</span>
            <p className="sound-text mt-1 font-mono text-4xl font-semibold leading-none">
              {profile.display}
            </p>
          </div>
          <span className="sound-text w-20 shrink-0 sm:w-24">
            <MouthDiagram sound={sound} />
          </span>
        </div>

        {/* Word */}
        <div className="px-6 py-8 text-center sm:px-8 sm:py-10">
          <span className="label-mono text-ink-faint">Word</span>

          {loading ? (
            <div className="mt-4 flex justify-center" aria-hidden="true">
              <span className="h-14 w-52 animate-pulse rounded-2xl bg-paper-2" />
            </div>
          ) : prompt ? (
            <>
              <h1 className="mt-3 text-6xl font-bold tracking-tight text-ink sm:text-7xl">
                “{prompt.text}”
              </h1>
              <ol className="mt-5 flex flex-wrap justify-center gap-1.5">
                {prompt.phonemes.map((phoneme, index) => {
                  const isTarget = prompt.target_indices.includes(index)
                  return (
                    <li
                      key={`${phoneme}-${index}`}
                      className={`rounded-lg px-2.5 py-1 font-mono text-sm ${
                        isTarget
                          ? 'sound-bg font-bold text-white'
                          : 'bg-paper-2 text-ink-soft'
                      }`}
                    >
                      {phoneme}
                    </li>
                  )
                })}
              </ol>
              <p className="mt-3 text-sm text-ink-faint">
                The highlighted sound is the one being measured.
              </p>
            </>
          ) : null}

          {/* Live input, or an invitation when idle. */}
          {!reviewing && (
            <div className={`mt-8 ${recording ? 'text-bad' : 'sound-text'}`}>
              <WaveField
                amplitude={recording ? Math.max(level, 0.08) : 0.16}
                ambient={!recording}
                lines={recording ? 5 : 3}
                height={104}
              />
            </div>
          )}

          {processing ? (
            <div className="mt-6 flex flex-col items-center gap-4">
              <span
                aria-hidden="true"
                className="size-12 animate-spin rounded-full border-4 border-line border-t-ink"
                style={{ animationDuration: '1.1s' }}
              />
              <p className="text-xl font-semibold text-ink">Analyzing your sound…</p>
              <p className="max-w-sm text-sm text-ink-soft">
                Transcribing what you said and measuring how you said it.
              </p>
            </div>
          ) : reviewing && clip ? (
            <div className="mt-6 text-left">
              <RecordingReview
                clip={clip}
                busy={false}
                onUse={() => void handleUpload()}
                onDiscard={discardClip}
              />
            </div>
          ) : (
            <div className="mt-6">
              <RecordButton
                status={recordStatus}
                level={level}
                onStart={() => void handleStart()}
                onStop={() => void handleStop()}
                elapsedMs={elapsed}
                maxMs={MAX_CLIP_MS}
              />
            </div>
          )}
        </div>

        {/* Secondary actions — always a way onward. */}
        {!processing && !reviewing && (
          <div className="flex flex-wrap items-center justify-center gap-3 border-t border-line px-6 py-4">
            <Button
              variant="ghost"
              size="sm"
              disabled={recording || loading}
              onClick={() => void loadPrompt(sound, { fresh: true })}
            >
              Give me another word
            </Button>
            {state.attempts.length > 0 && (
              <ButtonLink to="/progress" variant="ghost" size="sm">
                See progress
              </ButtonLink>
            )}
          </div>
        )}
      </section>

      {state.micPermission === 'unknown' && !state.error && !reviewing && (
        <p className="mt-5 text-center text-sm text-ink-faint">
          Your browser will ask for microphone permission the first time you record.
          Nothing is recorded until you press the button, and nothing is sent until you
          listen back and approve it.
        </p>
      )}

      {state.error && (
        <div className="mt-6">
          <ErrorNotice
            error={state.error}
            retryLabel={clip ? 'Send it again' : 'Try again'}
            onRetry={() => {
              if (clip) {
                // The recording is fine; only the upload failed.
                void handleUpload()
                return
              }
              clearError()
              if (!state.prompt) void loadPrompt(sound)
            }}
            onDismiss={clearError}
          />
        </div>
      )}

      <aside className="panel mt-6 p-5 sm:p-6">
        <h2 className="label-mono text-ink-faint">How to make this sound</h2>
        <p className="mt-2 text-[0.95rem] leading-relaxed text-ink-soft">
          {profile.articulation}
        </p>
      </aside>
    </div>
  )
}
