import { useEffect, useRef, useState } from 'react'
import { Waveform } from './WaveField'

interface AudioClipPlayerProps {
  /** In-memory clip. Null once a reload has dropped it. */
  blob: Blob | null
  /** Normalised peaks measured when the clip was recorded. */
  peaks: number[]
  /** Decoded duration. MediaRecorder blobs often lack usable metadata. */
  durationS: number
  /** Fraction of the clip covering the target sound, 0–1. */
  highlight?: { from: number; to: number }
  label?: string
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 12 12" aria-hidden="true" fill="currentColor">
      <path d="M3 1.6v8.8L10.2 6z" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 12 12" aria-hidden="true" fill="currentColor">
      <rect x="2" y="1.5" width="3" height="9" rx="1" />
      <rect x="7" y="1.5" width="3" height="9" rx="1" />
    </svg>
  )
}

/**
 * Plays a recorded clip and draws it.
 *
 * This component owns the object URL: it is created when the blob arrives and
 * revoked when the blob changes or the component unmounts. Nothing else in
 * the app calls createObjectURL, so audio cannot leak across recordings.
 */
export function AudioClipPlayer({
  blob,
  peaks,
  durationS,
  highlight,
  label = 'Hear your recording',
}: AudioClipPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const frameRef = useRef(0)
  const [url, setUrl] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (!blob) {
      setUrl(null)
      return
    }
    const next = URL.createObjectURL(blob)
    setUrl(next)
    return () => {
      URL.revokeObjectURL(next)
    }
  }, [blob])

  // Track the playhead. `audio.duration` is unreliable for WebM, so progress
  // is measured against the duration we decoded ourselves.
  useEffect(() => {
    if (!playing) {
      cancelAnimationFrame(frameRef.current)
      return
    }
    const tick = () => {
      const audio = audioRef.current
      if (audio && durationS > 0) {
        setProgress(Math.min(1, audio.currentTime / durationS))
      }
      frameRef.current = requestAnimationFrame(tick)
    }
    frameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameRef.current)
  }, [playing, durationS])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onEnded = () => {
      setPlaying(false)
      setProgress(0)
    }
    const onPause = () => setPlaying(false)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('pause', onPause)
    return () => {
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('pause', onPause)
    }
  }, [url])

  if (!blob || !url) {
    return (
      <div>
        <div className="text-ink-faint">
          <Waveform peaks={peaks} highlight={highlight} />
        </div>
        <p className="label-mono mt-2 text-ink-faint">
          Playback is not available after a reload
        </p>
      </div>
    )
  }

  const toggle = () => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
      return
    }
    audio.currentTime = 0
    setProgress(0)
    void audio
      .play()
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false))
  }

  return (
    <div>
      <audio ref={audioRef} src={url} preload="metadata" />
      <Waveform
        peaks={peaks}
        highlight={highlight}
        progress={playing ? progress : undefined}
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-paper-2"
        >
          {playing ? <StopIcon /> : <PlayIcon />}
          {playing ? 'Stop' : label}
        </button>
        <span className="label-mono tabular-nums text-ink-faint">
          {durationS.toFixed(1)}s
        </span>
      </div>
    </div>
  )
}
