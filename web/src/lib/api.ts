/**
 * The only place the frontend talks to the analysis service.
 * Endpoints and payloads follow ARCHITECTURE.md §4.
 *
 * Every call hits the real API first. If the API is unreachable AND fixtures
 * are enabled, the call falls back to a development fixture that is stamped
 * `_fixture: true` and disclosed in the UI. With fixtures disabled, an
 * unreachable API surfaces as a normal, retryable error — no silent fakery.
 */

import type {
  ApiErrorBody,
  ApiErrorCode,
  AttemptResult,
  Exercise,
  HealthStatus,
  Prompt,
  SoundId,
  TargetSound,
  TranscriptionResponse,
} from '../types/api'
import type { RecordingClip } from './recorder'
import { SOUND_LIST } from '../data/sounds'
import {
  fixtureAttemptResult,
  fixtureExercise,
  fixturePrompt,
  fixturePromptById,
} from './fixtures'

const BASE = import.meta.env.VITE_API_BASE_URL ?? '/api'

/** Defaults on in dev, off in production builds. */
export const USE_FIXTURES =
  (import.meta.env.VITE_USE_FIXTURES ?? String(import.meta.env.DEV)) === 'true'

export class ApiError extends Error {
  code: ApiErrorCode
  retryable: boolean

  constructor(code: ApiErrorCode, message: string, retryable = true) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.retryable = retryable
  }
}

/** Distinguishes "the server said no" from "the server is not there". */
class Unreachable extends Error {}

/**
 * The server is up but has not implemented this endpoint yet (HTTP 501).
 * Distinct from Unreachable: it must NOT trip the unreachable cooldown,
 * because every other endpoint is working fine.
 */
class NotImplemented extends Error {}

/**
 * Once the service has proved to be down, stop hammering it — each attempt
 * costs a failed request and a browser console error. Re-probed after the
 * cooldown so a backend started mid-session is picked up without a reload.
 */
const UNREACHABLE_COOLDOWN_MS = 30_000
let unreachableUntil = 0

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, init)
  } catch (cause) {
    // An aborted request is a timeout, handled by the caller — not a sign
    // that the service is missing.
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    throw new Unreachable(path)
  }

  if (!response.ok) {
    let body: { error?: ApiErrorBody } | null = null
    try {
      body = await response.json()
    } catch {
      body = null
    }
    if (response.status === 501) throw new NotImplemented(path)
    if (body?.error) {
      throw new ApiError(body.error.code, body.error.message, body.error.retryable)
    }
    // 502/503/504 from the dev proxy means the backend is not running.
    if (response.status >= 502) throw new Unreachable(path)
    throw new ApiError('UNKNOWN', `Request failed (${response.status}).`, true)
  }

  return (await response.json()) as T
}

/* ── Demo fallback state ───────────────────────────────────────────
 *
 * `USE_FIXTURES` says the fallback is *permitted*. It says nothing about
 * whether it is being *used*, and the two were previously conflated: the
 * header warned "fixture fallback enabled" on every dev page load, including
 * when every single request was being served by the real backend. A banner
 * that cries wolf is worse than no banner, and in a demo it actively
 * misrepresents a working pipeline as a canned one.
 *
 * So the banner is driven by this instead — set only when a fixture result
 * has actually been returned, cleared as soon as a live call succeeds.
 */
let fixtureServed = false
const fixtureListeners = new Set<(active: boolean) => void>()

function setFixtureServed(active: boolean) {
  if (fixtureServed === active) return
  fixtureServed = active
  for (const listener of fixtureListeners) listener(active)
}

/** True only when a displayed value actually came from the fallback bank. */
export function isFixtureActive(): boolean {
  return fixtureServed
}

export function onFixtureStateChange(listener: (active: boolean) => void): () => void {
  fixtureListeners.add(listener)
  return () => fixtureListeners.delete(listener)
}

/**
 * Runs `live`; if the service is unreachable, uses `fixture` when fixtures are
 * enabled and otherwise reports a clean network error.
 */
async function withFixture<T>(live: () => Promise<T>, fixture: () => T): Promise<T> {
  if (USE_FIXTURES && Date.now() < unreachableUntil) {
    // TODO(fixture): remove once the backend is running.
    await delay(650)
    setFixtureServed(true)
    return fixture()
  }

  try {
    const result = await live()
    unreachableUntil = 0
    setFixtureServed(false)
    return result
  } catch (error) {
    if (error instanceof NotImplemented) {
      // Feature not built yet. Use the labelled fixture; do not mark the
      // whole service unreachable.
      if (USE_FIXTURES) {
        await delay(250)
        setFixtureServed(true)
        return fixture()
      }
      throw new ApiError(
        'NOT_IMPLEMENTED',
        'That part of the analysis service is not available yet.',
        false,
      )
    }
    if (error instanceof Unreachable) {
      unreachableUntil = Date.now() + UNREACHABLE_COOLDOWN_MS
      if (USE_FIXTURES) {
        // TODO(fixture): remove this branch once the backend is running.
        await delay(650)
        setFixtureServed(true)
        return fixture()
      }
      throw new ApiError(
        'NETWORK_UNAVAILABLE',
        'Cannot reach the analysis service. Check that the API is running.',
        true,
      )
    }
    throw error
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/* ── Endpoints ───────────────────────────────────────────────────────── */

export function getHealth(): Promise<HealthStatus> {
  return withFixture(
    () => request<HealthStatus>('/health'),
    () => ({
      status: 'degraded',
      models: { asr: false, acoustic: false },
      version: 'fixture',
    }),
  )
}

export function getSounds(): Promise<TargetSound[]> {
  return withFixture(
    () => request<TargetSound[]>('/sounds'),
    () =>
      SOUND_LIST.map((profile) => ({
        id: profile.id,
        ipa: profile.ipa,
        label: profile.label,
        description: profile.description,
      })),
  )
}

export function getPrompt(sound: SoundId, exclude: string[] = []): Promise<Prompt> {
  const query = new URLSearchParams({ sound, level: 'word' })
  if (exclude.length > 0) query.set('exclude', exclude.join(','))
  return withFixture(
    () => request<Prompt>(`/prompts?${query.toString()}`),
    () => fixturePrompt(sound, exclude),
  )
}

/** GET /api/prompts/{id} — used when practising a specific challenge word. */
export function getPromptById(id: string): Promise<Prompt> {
  return withFixture(
    () => request<Prompt>(`/prompts/${encodeURIComponent(id)}`),
    () => {
      const prompt = fixturePromptById(id)
      if (!prompt) {
        throw new ApiError('UNKNOWN', `No prompt with id "${id}".`, false)
      }
      return prompt
    },
  )
}

/** Upload ceiling. An 8 s clip is well under a megabyte on any codec. */
const UPLOAD_TIMEOUT_MS = 45_000

export interface SubmitAttemptInput {
  /** The measured clip, straight from the recorder. */
  clip: RecordingClip
  promptId: string
  sessionId: string
  exerciseId?: string
  /** Attempts already completed this session. Fixture sequencing only. */
  attemptIndex: number
  /** Used only to build the fixture; the real API reads the audio. */
  prompt: Prompt
}

/**
 * POST /api/attempts — multipart.
 *
 * The audio goes up in whatever container the browser produced; the client
 * measurements ride alongside it so the backend can preserve the original
 * capture metadata after transcoding to 16 kHz mono WAV.
 */
export function submitAttempt(input: SubmitAttemptInput): Promise<AttemptResult> {
  const { clip } = input

  const buildForm = () => {
    const form = new FormData()
    form.append('audio', clip.blob, `attempt.${clip.extension}`)
    form.append('prompt_id', input.promptId)
    form.append('session_id', input.sessionId)
    if (input.exerciseId) form.append('exercise_id', input.exerciseId)
    // Client-measured capture metadata (ClientAudioMeta).
    form.append('client_mime_type', clip.mimeType)
    form.append('client_duration_s', clip.durationS.toFixed(3))
    form.append('client_sample_rate', String(clip.sampleRate))
    form.append('client_channels', String(clip.channels))
    form.append('client_size_bytes', String(clip.sizeBytes))
    return form
  }

  return withFixture(
    async () => {
      // Never let a stalled upload hang the UI with no way out.
      const controller = new AbortController()
      const timer = window.setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS)
      try {
        return await request<AttemptResult>('/attempts', {
          method: 'POST',
          body: buildForm(),
          signal: controller.signal,
        })
      } catch (error) {
        if (controller.signal.aborted) {
          throw new ApiError(
            'UPLOAD_TIMEOUT',
            'The upload took too long. Check your connection and try again.',
            true,
          )
        }
        throw error
      } finally {
        window.clearTimeout(timer)
      }
    },
    () =>
      fixtureAttemptResult(input.prompt, input.attemptIndex, {
        mime_type: clip.mimeType,
        duration_s: Number(clip.durationS.toFixed(3)),
        sample_rate: clip.sampleRate,
        channels: clip.channels,
        size_bytes: clip.sizeBytes,
      }),
  )
}

export function generateExercise(attempt: AttemptResult): Promise<Exercise> {
  return withFixture(
    () =>
      request<Exercise>('/exercises', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attempt_id: attempt.attempt_id }),
      }),
    () => fixtureExercise(attempt),
  )
}


/**
 * POST /api/analyze — STAGE 1, transcription.
 *
 * Deliberately has no fixture fallback. A transcript is either produced by
 * the real service or not shown at all; inventing one would be exactly the
 * kind of fake signal the rest of this app avoids. Returns null when the
 * service is unavailable, and the UI simply omits the panel.
 */
export async function transcribe(input: {
  clip: RecordingClip
  promptId?: string
  sessionId?: string
  expectedText?: string
}): Promise<TranscriptionResponse | null> {
  const { clip } = input
  const form = new FormData()
  form.append('audio', clip.blob, `attempt.${clip.extension}`)
  if (input.promptId) form.append('prompt_id', input.promptId)
  if (input.sessionId) form.append('session_id', input.sessionId)
  // The target word is passed to Whisper as a decoding hint. It biases
  // recognition toward the expected word; it does not score anything.
  if (input.expectedText) form.append('expected_text', input.expectedText)
  form.append('client_mime_type', clip.mimeType)
  form.append('client_duration_s', clip.durationS.toFixed(3))
  form.append('client_sample_rate', String(clip.sampleRate))
  form.append('client_channels', String(clip.channels))
  form.append('client_size_bytes', String(clip.sizeBytes))

  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS)
  try {
    return await request<TranscriptionResponse>('/analyze', {
      method: 'POST',
      body: form,
      signal: controller.signal,
    })
  } catch {
    // Transcription is one signal among several. If it fails, the attempt
    // still stands — the panel is omitted rather than faked.
    return null
  } finally {
    window.clearTimeout(timer)
  }
}
