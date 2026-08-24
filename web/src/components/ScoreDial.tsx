import { useEffect, useRef, useState } from 'react'

/** Counts from 0 to `value` once, unless the user prefers reduced motion. */
export function useCountUp(value: number, durationMs = 900): number {
  const [display, setDisplay] = useState(value)
  const frameRef = useRef(0)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(value)
      return
    }
    const start = performance.now()
    const from = 0

    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs)
      // easeOutCubic
      const eased = 1 - Math.pow(1 - p, 3)
      setDisplay(from + (value - from) * eased)
      if (p < 1) frameRef.current = requestAnimationFrame(tick)
    }

    frameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameRef.current)
  }, [value, durationMs])

  return display
}

interface ScoreDialProps {
  /** 0–100. */
  value: number
  label: string
  sublabel?: string
  size?: number
}

export function ScoreDial({ value, label, sublabel, size = 208 }: ScoreDialProps) {
  const animated = useCountUp(value)
  const radius = 46
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - Math.max(0, Math.min(100, animated)) / 100)

  return (
    <div
      className="relative flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 120 120" className="size-full -rotate-90">
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth="9"
        />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke="var(--sound, var(--color-ink))"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-5xl font-bold tabular-nums text-ink">
          {Math.round(animated)}
          <span className="text-2xl font-semibold text-ink-faint">%</span>
        </span>
        <span className="label-mono mt-1 text-ink-faint">{label}</span>
        {sublabel && (
          <span className="mt-0.5 text-xs text-ink-faint">{sublabel}</span>
        )}
      </div>
    </div>
  )
}

const CONFIDENCE_BANDS = [
  { min: 0.75, label: 'High confidence', tone: 'text-good' },
  { min: 0.5, label: 'Moderate confidence', tone: 'text-warn' },
  { min: 0, label: 'Low confidence', tone: 'text-ink-faint' },
]

/**
 * How sure the analysis is about the deviation it named. Shown next to every
 * result — a score without its confidence is a half-truth.
 */
export function ConfidenceMeter({ value }: { value: number }) {
  const band = CONFIDENCE_BANDS.find((b) => value >= b.min) ?? CONFIDENCE_BANDS[2]
  const filled = Math.round(Math.max(0, Math.min(1, value)) * 10)

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="label-mono text-ink-faint">Confidence</span>
        <span className={`text-sm font-semibold ${band.tone}`}>{band.label}</span>
      </div>
      <div
        className="mt-2 flex gap-1"
        role="meter"
        aria-valuenow={Math.round(value * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Analysis confidence: ${Math.round(value * 100)} percent`}
      >
        {Array.from({ length: 10 }, (_, i) => (
          <span
            key={i}
            className={`h-2 flex-1 rounded-full ${
              i < filled ? 'bg-ink' : 'bg-line'
            }`}
          />
        ))}
      </div>
    </div>
  )
}
