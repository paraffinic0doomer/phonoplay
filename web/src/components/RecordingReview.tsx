import type { RecordingClip } from '../lib/recorder'
import { AudioClipPlayer } from './AudioClipPlayer'
import { Button } from './Button'

interface RecordingReviewProps {
  clip: RecordingClip
  /** True while the clip is being uploaded and analysed. */
  busy: boolean
  onUse: () => void
  onDiscard: () => void
}

/** "audio/webm;codecs=opus" reads better as "WebM · Opus". */
function formatLabel(mimeType: string): string {
  const [container, codecs] = mimeType.split(';')
  const name =
    container
      .replace('audio/', '')
      .replace('webm', 'WebM')
      .replace('ogg', 'Ogg')
      .replace('mp4', 'MP4')
      .replace('wav', 'WAV') || 'unknown'
  const codec = codecs?.match(/codecs=([\w.]+)/)?.[1]
  if (!codec) return name
  return `${name} · ${codec.replace('opus', 'Opus').replace('mp4a.40.2', 'AAC')}`
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label-mono text-ink-faint">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink">{value}</dd>
    </div>
  )
}

/**
 * Sits between recording and upload. Nothing is transmitted until the learner
 * listens back and presses "Use this recording" — stopping a recording is not
 * on its own consent to send audio anywhere.
 *
 * It also shows exactly what was captured. Those four values travel with the
 * upload so the backend can preserve them through transcoding.
 */
export function RecordingReview({ clip, busy, onUse, onDiscard }: RecordingReviewProps) {
  return (
    <section className="panel animate-rise p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="label-mono text-ink-faint">Check your recording</h2>
        <span className="label-mono text-ink-faint">Nothing has been sent yet</span>
      </div>

      <div className="sound-text mt-4">
        <AudioClipPlayer
          blob={clip.blob}
          peaks={clip.peaks}
          durationS={clip.durationS}
          label="Play it back"
        />
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-4 sm:grid-cols-4">
        <Meta label="Length" value={`${clip.durationS.toFixed(2)}s`} />
        <Meta label="Format" value={formatLabel(clip.mimeType)} />
        <Meta
          label="Sample rate"
          value={clip.sampleRate ? `${(clip.sampleRate / 1000).toFixed(1)} kHz` : '—'}
        />
        <Meta label="Size" value={`${Math.max(1, Math.round(clip.sizeBytes / 1024))} kB`} />
      </dl>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button variant="sound" size="lg" onClick={onUse} disabled={busy}>
          {busy ? 'Sending…' : 'Use this recording'}
        </Button>
        <Button variant="outline" size="lg" onClick={onDiscard} disabled={busy}>
          Record again
        </Button>
      </div>
    </section>
  )
}
