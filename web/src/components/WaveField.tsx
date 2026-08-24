import { useEffect, useRef } from 'react'

interface WaveFieldProps {
  /**
   * 0–1. On the practice screen this is the real microphone RMS from
   * Recorder.level(); on the landing hero it drives an ambient idle motion.
   */
  amplitude?: number
  /** Adds a slow autonomous swell, for decorative use. */
  ambient?: boolean
  lines?: number
  className?: string
  /** Height in CSS pixels. Width always fills the container. */
  height?: number
}

/**
 * Layered wave strokes on a canvas. Takes its colour from the CSS `color` of
 * its container, so it inherits per-sound theming for free.
 */
export function WaveField({
  amplitude = 0.3,
  ambient = false,
  lines = 4,
  className = '',
  height = 160,
}: WaveFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Read inside the animation loop without restarting it on every change.
  const amplitudeRef = useRef(amplitude)
  useEffect(() => {
    amplitudeRef.current = amplitude
  }, [amplitude])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let colour = getComputedStyle(canvas).color
    let width = 0
    let frame = 0
    let smoothed = amplitudeRef.current
    let start = performance.now()

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const rect = canvas.getBoundingClientRect()
      width = Math.max(rect.width, 1)
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      colour = getComputedStyle(canvas).color
    }

    const draw = (now: number) => {
      const t = (now - start) / 1000
      const target = amplitudeRef.current
      smoothed += (target - smoothed) * 0.14

      // Ambient adds a gentle breathing floor so the hero is never still.
      const swell = ambient ? 0.5 + 0.5 * Math.sin(t * 0.7) : 1
      const level = Math.max(0.04, smoothed) * swell

      ctx.clearRect(0, 0, width, height)
      const mid = height / 2

      for (let line = 0; line < lines; line++) {
        const depth = line / Math.max(lines - 1, 1)
        const reach = (1 - depth * 0.62) * level * (height * 0.42)
        const frequency = 1.4 + line * 0.85
        const speed = 0.9 + line * 0.35
        const phase = line * 1.9

        ctx.beginPath()
        for (let x = 0; x <= width; x += 3) {
          const p = x / Math.max(width, 1)
          // Taper to zero at both edges so strokes never clip flat.
          const envelope = Math.sin(p * Math.PI) ** 0.8
          const y =
            mid +
            Math.sin(p * Math.PI * 2 * frequency + t * speed + phase) *
              reach *
              envelope +
            Math.sin(p * Math.PI * 2 * (frequency * 2.3) + t * speed * 1.6) *
              reach *
              0.28 *
              envelope
          if (x === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.strokeStyle = colour
        ctx.globalAlpha = 0.85 - depth * 0.62
        ctx.lineWidth = 2.75 - depth * 1.55
        ctx.lineCap = 'round'
        ctx.stroke()
      }
      ctx.globalAlpha = 1

      if (!reduceMotion) frame = requestAnimationFrame(draw)
    }

    resize()
    if (reduceMotion) {
      // One static pose rather than nothing at all.
      start = performance.now()
      draw(start)
    } else {
      frame = requestAnimationFrame(draw)
    }

    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [ambient, lines, height])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`block w-full ${className}`}
      style={{ height }}
    />
  )
}

/**
 * Static bars drawn from real decoded peaks of the learner's recording.
 * `highlight` marks the slice covering the target sound.
 */
export function Waveform({
  peaks,
  highlight,
  progress,
  className = '',
}: {
  peaks: number[]
  highlight?: { from: number; to: number }
  /** Playhead position 0–1. Bars before it are drawn at full strength. */
  progress?: number
  className?: string
}) {
  if (peaks.length === 0) {
    return (
      <div
        className={`flex h-16 items-center justify-center rounded-xl bg-paper-2 text-xs text-ink-faint ${className}`}
      >
        Waveform unavailable
      </div>
    )
  }

  const gap = 100 / peaks.length
  return (
    <svg
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      role="img"
      aria-label="Waveform of your recording"
      className={`h-16 w-full ${className}`}
    >
      {peaks.map((peak, i) => {
        const p = i / peaks.length
        const inHighlight =
          highlight !== undefined && p >= highlight.from && p <= highlight.to
        const played = progress !== undefined && p <= progress
        const barHeight = Math.max(1.4, peak * 34)
        return (
          <rect
            key={i}
            x={i * gap + gap * 0.18}
            y={20 - barHeight / 2}
            width={gap * 0.64}
            height={barHeight}
            rx={gap * 0.32}
            fill="currentColor"
            opacity={inHighlight || played ? 1 : 0.28}
          />
        )
      })}
    </svg>
  )
}
