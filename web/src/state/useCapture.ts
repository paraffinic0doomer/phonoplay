import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AudioRecorder,
  CLIP_PROBLEM,
  RecorderError,
  detectSupport,
  validateClip,
  watchMicPermission,
} from '../lib/recorder'
import type {
  MicPermission,
  RecordingClip,
  SupportLevel,
} from '../lib/recorder'

/**
 * The microphone half of the capture machine, owned in one place.
 *
 * Practice and Journey each grew their own copy of this: two `handleStart`s,
 * two `handleStop`s, two mappings from RecorderError to a UI error, two
 * different sets of wording for the same unusable clip. They had drifted —
 * one reported a too-long recording under the code `AUDIO_TOO_SHORT`, the
 * other reported a too-short one as `RECORDING_EMPTY`. Neither released the
 * microphone correctly if the learner navigated away mid-prompt.
 *
 * This hook owns the device: permission, start, stop, validation, teardown,
 * and the mapping of every failure onto a code the UI can explain. It does
 * NOT own the displayed status — Practice keeps that in the session reducer
 * and Journey in local state — so it reports transitions through callbacks
 * instead. One device lifecycle, two presentations.
 *
 * The states it drives the caller through:
 *
 *   idle ─▶ requesting-permission ─▶ recording ─▶ (review) ─▶ processing
 *                     │                   │
 *                     └──────▶ error ◀────┘
 *
 * Nothing here uploads. `onClip` hands back a measured clip for the learner
 * to listen to first; transmitting is a separate, explicit action.
 */

export interface CaptureError {
  code: string
  message: string
  retryable: boolean
}

export interface CaptureCallbacks {
  /** Entering the browser's permission prompt, before it appears. */
  onPermissionRequest?: () => void
  /** The device is live and capturing. */
  onRecordingStart: () => void
  /** A measured, validated clip is ready for review. Nothing has been sent. */
  onClip: (clip: RecordingClip) => void
  onError: (error: CaptureError) => void
  onPermissionChange?: (permission: MicPermission) => void
}

export interface Capture {
  /** Passed to RecordControl, which reads live input level from it. */
  recorderRef: React.RefObject<AudioRecorder | null>
  start: () => Promise<void>
  stop: () => Promise<void>
  /** Release the device and discard. Safe at any time. */
  cancel: () => void
  support: SupportLevel
  permission: MicPermission
}

/** Every failure the learner can hit, in words that suggest what to do. */
function toCaptureError(cause: unknown): CaptureError {
  const code = cause instanceof RecorderError ? cause.code : 'RECORDING_FAILED'
  return {
    code,
    message:
      cause instanceof Error ? cause.message : 'Recording could not start.',
    // These two cannot be fixed by pressing the button again.
    retryable: code !== 'MIC_UNSUPPORTED' && code !== 'MIC_INSECURE_CONTEXT',
  }
}

export function useCapture(callbacks: CaptureCallbacks): Capture {
  const recorderRef = useRef<AudioRecorder | null>(null)
  /** False once unmounted, so no callback fires into a dead component. */
  const alive = useRef(true)
  /** Guards a second start/stop while one is still in flight. */
  const busy = useRef(false)

  // Detected once. `detectSupport` reads only stable browser capabilities.
  const [support] = useState<SupportLevel>(() => detectSupport())
  const [permission, setPermission] = useState<MicPermission>(() =>
    detectSupport() === 'ok' ? 'unknown' : 'unavailable',
  )

  // Callers pass inline closures that change identity every render. Reading
  // them through a ref keeps `start` and `stop` stable, so the effects that
  // depend on them do not restart mid-recording.
  const handlers = useRef(callbacks)
  useEffect(() => {
    handlers.current = callbacks
  })

  const report = useCallback((next: MicPermission) => {
    if (!alive.current) return
    setPermission(next)
    handlers.current.onPermissionChange?.(next)
  }, [])

  /* Track permission for as long as the screen is open. */
  useEffect(() => {
    if (support !== 'ok') {
      report('unavailable')
      return
    }
    return watchMicPermission(report)
  }, [support, report])

  /* Release the microphone on unmount, however we got there. */
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      recorderRef.current?.cancel()
      recorderRef.current = null
    }
  }, [])

  const start = useCallback(async () => {
    // Double-press, or a keyboard shortcut racing the button.
    if (busy.current || recorderRef.current) return
    busy.current = true

    try {
      handlers.current.onPermissionRequest?.()

      const recorder = new AudioRecorder()
      recorderRef.current = recorder

      // The device can vanish mid-recording — unplugged, or grabbed by
      // another app. That is a failure, not a stop.
      recorder.onRecordingFailure = (failure) => {
        recorderRef.current = null
        if (!alive.current) return
        handlers.current.onError({
          code: failure.code,
          message: failure.message,
          retryable: true,
        })
      }

      try {
        await recorder.start()
      } catch (cause) {
        recorderRef.current = null
        const error = toCaptureError(cause)
        if (error.code === 'MIC_DENIED') report('denied')
        else if (
          error.code === 'MIC_UNSUPPORTED' ||
          error.code === 'MIC_INSECURE_CONTEXT'
        ) {
          report('unavailable')
        }
        if (alive.current) handlers.current.onError(error)
        return
      }

      // Leaving the screen while the permission dialog is open used to strand
      // the session in `recording` with no recorder behind it: the button
      // stayed on "stop", and stopping did nothing because the ref was gone.
      if (!alive.current) {
        recorder.cancel()
        recorderRef.current = null
        return
      }

      report('granted')
      handlers.current.onRecordingStart()
    } finally {
      busy.current = false
    }
  }, [report])

  const stop = useCallback(async () => {
    const recorder = recorderRef.current
    // Already stopped, already failed, or a stop still running.
    if (!recorder || busy.current) return
    busy.current = true

    try {
      const clip = await recorder.stop()
      recorderRef.current = null
      if (!alive.current) return

      // The gate: a recording that carries no speech is never offered for
      // upload, and never reaches the network.
      const problem = validateClip(clip)
      if (problem) {
        handlers.current.onError({ ...CLIP_PROBLEM[problem], retryable: true })
        return
      }

      handlers.current.onClip(clip)
    } catch (cause) {
      recorderRef.current = null
      if (alive.current) handlers.current.onError(toCaptureError(cause))
    } finally {
      busy.current = false
    }
  }, [])

  const cancel = useCallback(() => {
    recorderRef.current?.cancel()
    recorderRef.current = null
  }, [])

  return { recorderRef, start, stop, cancel, support, permission }
}
