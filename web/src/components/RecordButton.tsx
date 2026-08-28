import { useEffect, useState } from 'react'

/**
 * The button's view of the capture machine. Mirrors FlowStatus in
 * state/session.tsx, narrowed to what the microphone control cares about.
 */
export type RecordStatus =
  | 'idle'
  | 'requesting-permission'
  | 'ready'
  | 'recording'
  | 'review'
  | 'processing'
  | 'success'
  | 'error'
  | 'blocked'

interface RecordButtonProps {
  status: RecordStatus
  /** Live microphone level, 0–1. Drives the ring — real input, not a loop. */
  level: number
  onStart: () => void
  onStop: () => void
  /** Milliseconds recorded so far. */
  elapsedMs: number
  maxMs: number
}

function MicIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="2.5" width="6" height="11" rx="3" fill="currentColor" />
      <path
        d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21m-3 0h6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="3" fill="currentColor" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12.5 10 17.5 19 7"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function BlockedIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="2.5" width="6" height="11" rx="3" fill="currentColor" opacity="0.5" />
      <path
        d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.5"
      />
      <path d="M4 20 20 4" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  )
}

/** One row of state-specific presentation, so the states stay comparable. */
const HINTS: Record<RecordStatus, string> = {
  idle: 'Getting ready…',
  'requesting-permission': 'Allow the microphone in your browser',
  ready: 'Tap the microphone, or press Enter when it is focused',
  recording: '',
  review: 'Listen back, then choose below',
  processing: 'Working…',
  success: 'Done',
  error: 'Something went wrong — see below',
  blocked: 'Recording is unavailable',
}

export function RecordButton({
  status,
  level,
  onStart,
  onStop,
  elapsedMs,
  maxMs,
}: RecordButtonProps) {
  const recording = status === 'recording'
  const requesting = status === 'requesting-permission'
  const processing = status === 'processing'
  const success = status === 'success'
  const blocked = status === 'blocked'

  const interactive = status === 'ready' || status === 'error' || recording
  const disabled = !interactive

  // Ring scale follows real loudness, floored so it is always visibly alive.
  const ringScale = recording ? 1 + Math.min(level, 1) * 0.55 : 1
  const seconds = (elapsedMs / 1000).toFixed(1)
  const remaining = Math.max(0, maxMs - elapsedMs)

  const label = recording
    ? 'Stop recording'
    : requesting
      ? 'Waiting for microphone permission'
      : processing
        ? 'Analysing your recording'
        : blocked
          ? 'Recording unavailable'
          : 'Start recording'

  const face = () => {
    if (recording) return <StopIcon />
    if (success) return <CheckIcon />
    if (blocked) return <BlockedIcon />
    return <MicIcon />
  }

  const surface = () => {
    if (recording) return 'bg-bad'
    if (success) return 'bg-good'
    if (blocked) return 'bg-ink-faint'
    return 'sound-bg'
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative flex size-44 items-center justify-center">
        {/* Live level ring — driven by real input */}
        {recording && (
          <span
            aria-hidden="true"
            className="absolute size-32 rounded-full bg-bad/25 transition-transform duration-75 ease-out"
            style={{ transform: `scale(${ringScale})` }}
          />
        )}
        {/* Idle invitation */}
        {status === 'ready' && (
          <span
            aria-hidden="true"
            className="sound-bg absolute size-32 animate-breathe rounded-full opacity-40"
          />
        )}
        {/* Waiting on the browser's permission dialog */}
        {requesting && (
          <span
            aria-hidden="true"
            className="sound-bg absolute size-36 animate-breathe rounded-full opacity-30"
            style={{ animationDuration: '1.4s' }}
          />
        )}
        {processing && (
          <span
            aria-hidden="true"
            className="absolute size-36 animate-spin rounded-full border-4 border-line border-t-ink"
            style={{ animationDuration: '1.1s' }}
          />
        )}

        <button
          type="button"
          onClick={recording ? onStop : onStart}
          disabled={disabled}
          aria-label={label}
          aria-pressed={recording}
          aria-busy={processing || requesting}
          className={`relative flex size-32 items-center justify-center rounded-full text-white shadow-[0_6px_0_0_rgba(23,21,29,0.18)] transition-[transform,background-color] duration-150 active:translate-y-1 active:shadow-[0_2px_0_0_rgba(23,21,29,0.18)] disabled:active:translate-y-0 disabled:active:shadow-[0_6px_0_0_rgba(23,21,29,0.18)] ${
            disabled && !success && !blocked ? 'opacity-60' : ''
          } ${surface()}`}
        >
          {face()}
        </button>
      </div>

      <div className="flex h-6 items-center justify-center text-center">
        {recording ? (
          <span className="label-mono flex items-center gap-2 text-bad">
            <span className="size-2 animate-blink rounded-full bg-bad" aria-hidden="true" />
            Recording {seconds}s
            {remaining < 2000 && <span className="text-ink-faint">· wrapping up</span>}
          </span>
        ) : (
          <span className="label-mono text-ink-faint">{HINTS[status]}</span>
        )}
      </div>
    </div>
  )
}

/** Ticks while `active`, for the recording timer. */
export function useElapsed(active: boolean): number {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!active) {
      setElapsed(0)
      return
    }
    const start = performance.now()
    const id = window.setInterval(() => setElapsed(performance.now() - start), 100)
    return () => window.clearInterval(id)
  }, [active])

  return elapsed
}
