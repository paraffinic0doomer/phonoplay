import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { AudioRecorder, MAX_CLIP_MS } from '../lib/recorder'
import { RecordButton } from './RecordButton'
import type { RecordStatus } from './RecordButton'

/** Stable identity, so an idle render never allocates a new object. */
const ZERO = { level: 0, elapsedMs: 0 } as const

/**
 * The microphone button, and the 60 Hz state that drives it.
 *
 * This component exists for one reason: to stop the live input level from
 * re-rendering the page around it. The level and the elapsed timer update on
 * every animation frame, and when that state lived in the page component the
 * entire tree — language bar, bridge, journey, exercise panel — re-rendered
 * sixty times a second while recording.
 *
 * That was measurable, not theoretical. Under a 4x CPU throttle the journey
 * screen was dropping 10% of frames during recording (p95 frame time 40ms),
 * against 2% on the lighter practice screen. Recording is the moment the
 * product is most visibly "live", so jank there is the worst place to have
 * it. With the state owned here, only this subtree re-renders.
 *
 * The recorder itself stays in a ref owned by the parent: it outlives this
 * component's state and the parent needs it to stop and read the clip.
 */
export function RecordControl({
  recorderRef,
  status,
  onStart,
  onStop,
  maxMs = MAX_CLIP_MS,
}: {
  recorderRef: RefObject<AudioRecorder | null>
  status: RecordStatus
  onStart: () => void
  /** Called by the learner, and automatically at `maxMs`. */
  onStop: () => void
  maxMs?: number
}) {
  // One state object rather than two, so a frame produces one re-render
  // instead of two.
  const [live, setLive] = useState({ level: 0, elapsedMs: 0 })

  // Read inside the animation frame so the effect does not restart every time
  // the parent re-creates its handler. Assigned in an effect rather than
  // during render: writing a ref while rendering is a side effect, and React
  // makes no promise about when a render runs.
  const stopRef = useRef(onStop)
  useEffect(() => {
    stopRef.current = onStop
  })

  useEffect(() => {
    // Nothing to animate when not recording. The values are read back through
    // `recording ? live : ZERO` below, so there is no reset to write here —
    // and no extra render on stop.
    if (status !== 'recording') return

    const startedAt = performance.now()
    let frame = 0
    let stopped = false

    const tick = () => {
      const recorder = recorderRef.current
      if (!recorder?.isRecording) return

      const elapsed = performance.now() - startedAt
      setLive({ level: recorder.level(), elapsedMs: elapsed })

      if (elapsed >= maxMs) {
        // The cap fires once. Without the guard a slow stop would let the
        // next frame fire it again.
        if (!stopped) {
          stopped = true
          stopRef.current()
        }
        return
      }
      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [status, maxMs, recorderRef])

  const shown = status === 'recording' ? live : ZERO

  return (
    <RecordButton
      status={status}
      level={shown.level}
      elapsedMs={shown.elapsedMs}
      maxMs={maxMs}
      onStart={onStart}
      onStop={onStop}
    />
  )
}
