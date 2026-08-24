/**
 * The application's real state: which sound is being practised, which prompt
 * is on screen, the clip currently awaiting the learner's approval, every
 * attempt made this session with its actual scores, and the current challenge.
 *
 * ── Capture state machine ────────────────────────────────────────────────
 *
 *   idle ─▶ loading-prompt ─▶ ready
 *                               │
 *                               ├─▶ requesting-permission ─▶ recording
 *                               │                               │
 *                               │                        (stop / 8s cap)
 *                               │                               ▼
 *                               │                            review ──┐
 *                               │                               │     │
 *                               │        "Record again" ────────┘     │
 *                               │                     "Use this recording"
 *                               │                                     ▼
 *                               │                                processing
 *                               │                                     │
 *                               └────────── error ◀── failure ────── success
 *
 * `review` exists so audio is only ever transmitted after an explicit second
 * user action. Stopping a recording uploads nothing.
 *
 * Audio blobs live in memory only. They are never written to sessionStorage
 * and never outlive the session; object URLs are created and revoked by the
 * component that plays them, not held here.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react'
import type {
  AttemptResult,
  Exercise,
  Prompt,
  SoundId,
  TranscriptionResponse,
} from '../types/api'
import {
  ApiError,
  generateExercise,
  getPrompt,
  getPromptById,
  submitAttempt,
  transcribe,
} from '../lib/api'
import type { MicPermission, RecordingClip } from '../lib/recorder'

export interface AttemptRecord {
  id: string
  promptText: string
  targetSound: SoundId
  result: AttemptResult
  /** Peaks decoded from the learner's own recording. */
  waveform: number[]
  /** In-memory only. Null after a reload — blobs are never persisted. */
  audio: Blob | null
  /**
   * STAGE 1 result from POST /api/analyze, when the service answered.
   * Null means transcription was unavailable — never a fabricated stand-in.
   * This is a separate signal from `result` and must not be read as a
   * pronunciation score.
   */
  transcription: TranscriptionResponse | null
  createdAt: string
}

/** The seven required UI states, plus the two that gate them. */
export type FlowStatus =
  | 'idle'
  | 'loading-prompt'
  | 'requesting-permission'
  | 'ready'
  | 'recording'
  | 'review'
  | 'processing'
  | 'success'
  | 'error'

export interface AppError {
  code: string
  message: string
  retryable: boolean
}

export interface SessionState {
  sessionId: string
  targetSound: SoundId | null
  prompt: Prompt | null
  status: FlowStatus
  /** Captured, measured, and awaiting the learner's decision. */
  clip: RecordingClip | null
  attempts: AttemptRecord[]
  latestAttemptId: string | null
  exercise: Exercise | null
  exerciseStatus: 'idle' | 'loading' | 'ready' | 'error'
  error: AppError | null
  micPermission: MicPermission
  seenPromptIds: string[]
}

type Action =
  | { type: 'select-sound'; sound: SoundId }
  | { type: 'prompt-loading' }
  | { type: 'prompt-loaded'; prompt: Prompt }
  | { type: 'requesting-permission' }
  | { type: 'recording-started' }
  | { type: 'clip-captured'; clip: RecordingClip }
  | { type: 'clip-discarded' }
  | { type: 'uploading' }
  | { type: 'attempt-complete'; attempt: AttemptRecord }
  | { type: 'exercise-loading' }
  | { type: 'exercise-loaded'; exercise: Exercise }
  | { type: 'exercise-failed' }
  | { type: 'error'; error: AppError; keepClip?: boolean }
  | { type: 'clear-error' }
  | { type: 'mic-permission'; permission: MicPermission }
  | { type: 'reset-flow' }
  | { type: 'reset-session' }

const STORAGE_KEY = 'phonoplay.session.v2'

function newSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function initialState(): SessionState {
  return {
    sessionId: newSessionId(),
    targetSound: null,
    prompt: null,
    status: 'idle',
    clip: null,
    attempts: [],
    latestAttemptId: null,
    exercise: null,
    exerciseStatus: 'idle',
    error: null,
    micPermission: 'unknown',
    seenPromptIds: [],
  }
}

/** Where to land when an error is dismissed: back where the work still is. */
function recoveredStatus(state: SessionState): FlowStatus {
  if (state.clip) return 'review'
  if (state.prompt) return 'ready'
  return 'idle'
}

function reducer(state: SessionState, action: Action): SessionState {
  switch (action.type) {
    case 'select-sound':
      // Switching sounds clears the current prompt and any pending clip but
      // keeps the attempt history — progress spans the whole session.
      return {
        ...state,
        targetSound: action.sound,
        prompt: null,
        clip: null,
        status: 'idle',
        exercise: null,
        exerciseStatus: 'idle',
        error: null,
      }

    case 'prompt-loading':
      return { ...state, status: 'loading-prompt', clip: null, error: null }

    case 'prompt-loaded':
      return {
        ...state,
        prompt: action.prompt,
        status: 'ready',
        error: null,
        seenPromptIds: state.seenPromptIds.includes(action.prompt.id)
          ? state.seenPromptIds
          : [...state.seenPromptIds, action.prompt.id],
      }

    case 'requesting-permission':
      return { ...state, status: 'requesting-permission', clip: null, error: null }

    case 'recording-started':
      return { ...state, status: 'recording', clip: null, error: null }

    case 'clip-captured':
      return { ...state, status: 'review', clip: action.clip, error: null }

    case 'clip-discarded':
      return { ...state, status: state.prompt ? 'ready' : 'idle', clip: null, error: null }

    case 'uploading':
      return { ...state, status: 'processing', error: null }

    case 'attempt-complete':
      return {
        ...state,
        status: 'success',
        // The clip now belongs to the attempt record.
        clip: null,
        attempts: [...state.attempts, action.attempt],
        latestAttemptId: action.attempt.id,
        exercise: null,
        exerciseStatus: 'idle',
        error: null,
      }

    case 'exercise-loading':
      return { ...state, exerciseStatus: 'loading' }

    case 'exercise-loaded':
      return { ...state, exercise: action.exercise, exerciseStatus: 'ready' }

    case 'exercise-failed':
      return { ...state, exerciseStatus: 'error' }

    case 'error':
      // A failed upload keeps the clip so the learner can retry sending the
      // same recording rather than being made to say the word again.
      return {
        ...state,
        status: 'error',
        clip: action.keepClip ? state.clip : null,
        error: action.error,
      }

    case 'clear-error':
      return { ...state, error: null, status: recoveredStatus(state) }

    case 'mic-permission':
      return { ...state, micPermission: action.permission }

    case 'reset-flow':
      return { ...state, status: recoveredStatus(state), error: null }

    case 'reset-session':
      return { ...initialState(), micPermission: state.micPermission }

    default:
      return state
  }
}

/* ── Persistence ─────────────────────────────────────────────────────────
 * Scores and prompts persist so a reload resumes instead of dropping the
 * learner on an empty screen. Audio never does.
 */

function persist(state: SessionState) {
  try {
    const serialisable = {
      ...state,
      clip: null,
      attempts: state.attempts.map((attempt) => ({ ...attempt, audio: null })),
      status: state.status === 'success' ? 'success' : 'idle',
      error: null,
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(serialisable))
  } catch {
    // Private mode or storage disabled — the app works without persistence.
  }
}

function restore(): SessionState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SessionState
    if (!parsed.sessionId || !Array.isArray(parsed.attempts)) return null
    return {
      ...parsed,
      clip: null,
      error: null,
      micPermission: 'unknown',
      attempts: parsed.attempts.map((attempt) => ({ ...attempt, audio: null })),
    }
  } catch {
    return null
  }
}

/* ── Context ─────────────────────────────────────────────────────────── */

export interface SessionContextValue {
  state: SessionState
  selectSound: (sound: SoundId) => void
  loadPrompt: (
    sound: SoundId,
    options?: { fresh?: boolean; promptId?: string },
  ) => Promise<void>
  /** Entering the permission prompt, before the browser dialog appears. */
  beginPermissionRequest: () => void
  recordingStarted: () => void
  /** A measured clip is ready for the learner to review. Uploads nothing. */
  clipCaptured: (clip: RecordingClip) => void
  discardClip: () => void
  /** Explicit consent to transmit. Resolves true when the attempt is stored. */
  uploadClip: () => Promise<boolean>
  requestExercise: () => Promise<void>
  setMicPermission: (permission: MicPermission) => void
  reportError: (error: AppError, options?: { keepClip?: boolean }) => void
  clearError: () => void
  resetFlow: () => void
  resetSession: () => void
  attemptsForSound: (sound: SoundId) => AttemptRecord[]
  latestAttempt: AttemptRecord | null
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, null, () => restore() ?? initialState())

  // Kept in a ref so the async callbacks below never close over stale state.
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
    persist(state)
  }, [state])

  const toAppError = (error: unknown): AppError => {
    if (error instanceof ApiError) {
      return { code: error.code, message: error.message, retryable: error.retryable }
    }
    return {
      code: 'UNKNOWN',
      message: error instanceof Error ? error.message : 'Something went wrong.',
      retryable: true,
    }
  }

  const selectSound = useCallback((sound: SoundId) => {
    dispatch({ type: 'select-sound', sound })
  }, [])

  const loadPrompt = useCallback(
    async (sound: SoundId, options?: { fresh?: boolean; promptId?: string }) => {
      dispatch({ type: 'prompt-loading' })
      try {
        // A specific challenge word falls back to any prompt for the sound
        // rather than stranding the learner on an error.
        const prompt = options?.promptId
          ? await getPromptById(options.promptId).catch(() => getPrompt(sound))
          : await getPrompt(sound, options?.fresh ? stateRef.current.seenPromptIds : [])
        dispatch({ type: 'prompt-loaded', prompt })
      } catch (error) {
        dispatch({ type: 'error', error: toAppError(error) })
      }
    },
    [],
  )

  const beginPermissionRequest = useCallback(() => {
    dispatch({ type: 'requesting-permission' })
  }, [])

  const recordingStarted = useCallback(() => {
    dispatch({ type: 'recording-started' })
  }, [])

  const clipCaptured = useCallback((clip: RecordingClip) => {
    dispatch({ type: 'clip-captured', clip })
  }, [])

  const discardClip = useCallback(() => {
    dispatch({ type: 'clip-discarded' })
  }, [])

  const uploadClip = useCallback(async (): Promise<boolean> => {
    const current = stateRef.current
    const { clip, prompt } = current
    if (!clip || !prompt) return false

    dispatch({ type: 'uploading' })
    try {
      // The two stages run independently and are kept independent.
      // Stage 1 (transcription) is real; stage 2 (scoring) is still a
      // labelled fixture. Neither one's failure invalidates the other.
      const [result, transcription] = await Promise.all([
        submitAttempt({
          clip,
          promptId: prompt.id,
          sessionId: current.sessionId,
          exerciseId: current.exercise?.id,
          attemptIndex: current.attempts.length,
          prompt,
        }),
        transcribe({
          clip,
          promptId: prompt.id,
          sessionId: current.sessionId,
          expectedText: prompt.text,
        }),
      ])

      // The backend can still reject audio the client thought was fine.
      if (!result.audio_quality.ok) {
        dispatch({
          type: 'error',
          keepClip: false,
          error: {
            code: result.audio_quality.warnings[0] ?? 'AUDIO_TOO_QUIET',
            message:
              'That recording was too quiet or too short to analyse. Try again a little closer to the microphone.',
            retryable: true,
          },
        })
        return false
      }

      dispatch({
        type: 'attempt-complete',
        attempt: {
          id: result.attempt_id,
          promptText: prompt.text,
          targetSound: prompt.target_sound,
          result,
          waveform: clip.peaks,
          audio: clip.blob,
          transcription,
          createdAt: new Date().toISOString(),
        },
      })
      return true
    } catch (error) {
      // Hold on to the clip: the recording was fine, the send was not.
      dispatch({ type: 'error', error: toAppError(error), keepClip: true })
      return false
    }
  }, [])

  const requestExercise = useCallback(async () => {
    const current = stateRef.current
    const latest = current.attempts.at(-1)
    if (!latest || current.exerciseStatus === 'loading') return

    dispatch({ type: 'exercise-loading' })
    try {
      const exercise = await generateExercise(latest.result)
      dispatch({ type: 'exercise-loaded', exercise })
    } catch {
      dispatch({ type: 'exercise-failed' })
    }
  }, [])

  const setMicPermission = useCallback((permission: MicPermission) => {
    dispatch({ type: 'mic-permission', permission })
  }, [])

  const reportError = useCallback((error: AppError, options?: { keepClip?: boolean }) => {
    dispatch({ type: 'error', error, keepClip: options?.keepClip })
  }, [])

  const clearError = useCallback(() => dispatch({ type: 'clear-error' }), [])
  const resetFlow = useCallback(() => dispatch({ type: 'reset-flow' }), [])
  const resetSession = useCallback(() => dispatch({ type: 'reset-session' }), [])

  const attemptsForSound = useCallback(
    (sound: SoundId) => stateRef.current.attempts.filter((a) => a.targetSound === sound),
    [],
  )

  const value = useMemo<SessionContextValue>(
    () => ({
      state,
      selectSound,
      loadPrompt,
      beginPermissionRequest,
      recordingStarted,
      clipCaptured,
      discardClip,
      uploadClip,
      requestExercise,
      setMicPermission,
      reportError,
      clearError,
      resetFlow,
      resetSession,
      attemptsForSound,
      latestAttempt:
        state.attempts.find((a) => a.id === state.latestAttemptId) ??
        state.attempts.at(-1) ??
        null,
    }),
    [
      state,
      selectSound,
      loadPrompt,
      beginPermissionRequest,
      recordingStarted,
      clipCaptured,
      discardClip,
      uploadClip,
      requestExercise,
      setMicPermission,
      reportError,
      clearError,
      resetFlow,
      resetSession,
      attemptsForSound,
    ],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext)
  if (!context) throw new Error('useSession must be used inside <SessionProvider>.')
  return context
}
