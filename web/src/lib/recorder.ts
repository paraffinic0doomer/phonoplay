/**
 * Browser audio capture for PhonoPlay.
 *
 * Real MediaRecorder + Web Audio throughout — nothing here is simulated.
 * Responsibilities, in order:
 *
 *   1. Work out whether this browser can record at all, before offering to.
 *   2. Request microphone permission, mapping every failure to a code the UI
 *      can explain in plain language.
 *   3. Record into the best container the browser actually supports.
 *   4. Measure the result — duration, sample rate, channels, peak, RMS — so a
 *      clip can be checked for "empty" or "silent" before anything is sent.
 *   5. Release the device promptly.
 *
 * The blob produced here is whatever the browser encodes (WebM/Opus on
 * Chrome, Firefox, and Edge; MP4/AAC on Safari). We never assume WAV. The
 * backend transcodes to 16 kHz mono WAV with ffmpeg — see ARCHITECTURE.md §3.1.
 */

/* ── Clip length ─────────────────────────────────────────────────────────
 * The product targets 2–8 second clips. 8 s is a hard ceiling enforced by an
 * auto-stop. There is deliberately NO 2 s minimum: single words like "sun"
 * take well under a second, and rejecting them would be wrong. The lower
 * bound is only there to catch a click that captured nothing.
 */
export const MAX_CLIP_MS = 8000
export const MIN_CLIP_S = 0.35
/** Below this peak amplitude the clip carries no usable speech. */
export const SILENCE_PEAK_THRESHOLD = 0.02
/** Blobs smaller than this are a failed encode, not audio. */
const MIN_CLIP_BYTES = 1024

export type MicPermission = 'unknown' | 'granted' | 'denied' | 'unavailable'

export type RecorderErrorCode =
  | 'MIC_UNSUPPORTED'
  | 'MIC_INSECURE_CONTEXT'
  | 'MIC_DENIED'
  | 'MIC_NOT_FOUND'
  | 'MIC_BUSY'
  | 'RECORDING_FAILED'

export class RecorderError extends Error {
  code: RecorderErrorCode

  constructor(code: RecorderErrorCode, message: string) {
    super(message)
    this.name = 'RecorderError'
    this.code = code
  }
}

/** A captured clip plus everything measured about it. */
export interface RecordingClip {
  blob: Blob
  /** Exactly what the browser produced, e.g. "audio/webm;codecs=opus". */
  mimeType: string
  /** File extension matching `mimeType`, for the upload filename. */
  extension: string
  /** Decoded duration in seconds. Authoritative — see `analyseClip`. */
  durationS: number
  /** Capture rate reported by the device, before any transcoding. */
  sampleRate: number
  channels: number
  sizeBytes: number
  /** Peak amplitude, 0–1. Drives the silence check. */
  peak: number
  /** RMS level, 0–1. */
  rms: number
  /** Normalised peaks for waveform drawing. */
  peaks: number[]
}

export type ClipProblem = 'empty' | 'too-short' | 'silent' | 'too-long'

/* ── Capability detection ────────────────────────────────────────────── */

export type SupportLevel = 'ok' | 'unsupported' | 'insecure-context'

/**
 * getUserMedia is gated on a secure context. That is the single most common
 * reason recording "just doesn't work" when a dev serves over plain http on a
 * LAN address, so it gets its own result rather than a generic failure.
 */
export function detectSupport(): SupportLevel {
  if (typeof window === 'undefined') return 'unsupported'
  if (typeof MediaRecorder === 'undefined') return 'unsupported'
  if (!navigator.mediaDevices?.getUserMedia) {
    return window.isSecureContext ? 'unsupported' : 'insecure-context'
  }
  if (!window.isSecureContext) return 'insecure-context'
  return 'ok'
}

export function isRecordingSupported(): boolean {
  return detectSupport() === 'ok'
}

interface Format {
  mimeType: string
  extension: string
}

/**
 * The best container this browser will actually encode. Opus first for size
 * and quality; MP4/AAC is the Safari path. An empty mimeType means "let the
 * browser choose", which is the correct last resort.
 */
export function pickFormat(): Format {
  const candidates: Format[] = [
    { mimeType: 'audio/webm;codecs=opus', extension: 'webm' },
    { mimeType: 'audio/ogg;codecs=opus', extension: 'ogg' },
    { mimeType: 'audio/webm', extension: 'webm' },
    { mimeType: 'audio/mp4;codecs=mp4a.40.2', extension: 'm4a' },
    { mimeType: 'audio/mp4', extension: 'm4a' },
    { mimeType: 'audio/ogg', extension: 'ogg' },
  ]
  if (typeof MediaRecorder !== 'undefined') {
    for (const format of candidates) {
      if (MediaRecorder.isTypeSupported(format.mimeType)) return format
    }
  }
  return { mimeType: '', extension: 'bin' }
}

function extensionFor(mimeType: string): string {
  if (mimeType.includes('webm')) return 'webm'
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('mp4') || mimeType.includes('aac')) return 'm4a'
  if (mimeType.includes('wav')) return 'wav'
  return 'bin'
}

/** Maps a getUserMedia rejection onto something the UI can explain. */
function toRecorderError(cause: unknown): RecorderError {
  const name = cause instanceof Error ? cause.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return new RecorderError('MIC_DENIED', 'Microphone permission was refused.')
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return new RecorderError('MIC_NOT_FOUND', 'No microphone was found on this device.')
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return new RecorderError(
        'MIC_BUSY',
        'The microphone is in use by another application.',
      )
    default:
      return new RecorderError(
        'RECORDING_FAILED',
        cause instanceof Error ? cause.message : 'Recording could not start.',
      )
  }
}

/* ── Recorder ────────────────────────────────────────────────────────── */

export class AudioRecorder {
  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private context: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private buffer: Uint8Array<ArrayBuffer> | null = null
  private format: Format = { mimeType: '', extension: 'bin' }
  private settings: MediaTrackSettings | null = null
  /** Set when the device disappears or the encoder fails mid-recording. */
  private failure: RecorderError | null = null
  private onFailure: ((error: RecorderError) => void) | null = null

  get isRecording(): boolean {
    return this.recorder?.state === 'recording'
  }

  /** Called if recording dies on its own (device unplugged, encoder error). */
  set onRecordingFailure(handler: ((error: RecorderError) => void) | null) {
    this.onFailure = handler
  }

  /**
   * Requests the microphone and starts capturing.
   * Throws {@link RecorderError} with a specific code on every failure path.
   */
  async start(): Promise<void> {
    const support = detectSupport()
    if (support === 'insecure-context') {
      throw new RecorderError(
        'MIC_INSECURE_CONTEXT',
        'Recording needs a secure connection (https, or localhost).',
      )
    }
    if (support === 'unsupported') {
      throw new RecorderError(
        'MIC_UNSUPPORTED',
        'This browser cannot record audio.',
      )
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          // Off on purpose: automatic gain would rescale the very loudness
          // differences the analysis is measuring.
          autoGainControl: false,
        },
      })
    } catch (cause) {
      // A device that cannot honour the exact constraints should still be
      // usable — retry once with the loosest possible request.
      if (cause instanceof Error && cause.name === 'OverconstrainedError') {
        try {
          this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        } catch (retryCause) {
          this.teardown()
          throw toRecorderError(retryCause)
        }
      } else {
        this.teardown()
        throw toRecorderError(cause)
      }
    }

    const track = this.stream.getAudioTracks()[0]
    if (!track) {
      this.teardown()
      throw new RecorderError('MIC_NOT_FOUND', 'The microphone produced no audio track.')
    }
    this.settings = track.getSettings()

    // The device being pulled mid-recording is a real failure, not a stop.
    track.addEventListener('ended', () => {
      this.fail(new RecorderError('MIC_NOT_FOUND', 'The microphone was disconnected.'))
    })

    try {
      this.context = new AudioContext()
      if (this.context.state === 'suspended') await this.context.resume()
      const source = this.context.createMediaStreamSource(this.stream)
      this.analyser = this.context.createAnalyser()
      this.analyser.fftSize = 1024
      this.analyser.smoothingTimeConstant = 0.75
      source.connect(this.analyser)
      this.buffer = new Uint8Array(new ArrayBuffer(this.analyser.fftSize))

      this.format = pickFormat()
      this.recorder = new MediaRecorder(
        this.stream,
        this.format.mimeType ? { mimeType: this.format.mimeType } : undefined,
      )
      this.chunks = []
      this.failure = null

      this.recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) this.chunks.push(event.data)
      })
      this.recorder.addEventListener('error', () => {
        this.fail(new RecorderError('RECORDING_FAILED', 'The recorder stopped unexpectedly.'))
      })

      this.recorder.start()
    } catch (cause) {
      this.teardown()
      throw toRecorderError(cause)
    }
  }

  private fail(error: RecorderError) {
    if (this.failure) return
    this.failure = error
    this.onFailure?.(error)
  }

  /** Current input loudness, 0–1, from real samples. */
  level(): number {
    if (!this.analyser || !this.buffer) return 0
    this.analyser.getByteTimeDomainData(this.buffer)
    let sum = 0
    for (let i = 0; i < this.buffer.length; i++) {
      const centred = (this.buffer[i] - 128) / 128
      sum += centred * centred
    }
    const rms = Math.sqrt(sum / this.buffer.length)
    // Perceptual-ish curve so quiet speech still moves the meter.
    return Math.min(1, Math.pow(rms * 3.2, 0.7))
  }

  /**
   * Stops capture and returns the measured clip. Releases the microphone
   * before returning, so the browser's recording indicator clears promptly.
   */
  async stop(): Promise<RecordingClip> {
    const recorder = this.recorder
    if (!recorder) {
      throw new RecorderError('RECORDING_FAILED', 'The recorder was not running.')
    }

    const mimeType = recorder.mimeType || this.format.mimeType || 'audio/webm'

    const blob = await new Promise<Blob>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new RecorderError('RECORDING_FAILED', 'The recorder did not finish.'))
      }, 4000)

      recorder.addEventListener(
        'stop',
        () => {
          window.clearTimeout(timeout)
          resolve(new Blob(this.chunks, { type: mimeType }))
        },
        { once: true },
      )

      try {
        if (recorder.state !== 'inactive') recorder.stop()
        else {
          window.clearTimeout(timeout)
          resolve(new Blob(this.chunks, { type: mimeType }))
        }
      } catch (cause) {
        window.clearTimeout(timeout)
        reject(toRecorderError(cause))
      }
    })

    const settings = this.settings
    this.teardown()

    if (this.failure) throw this.failure

    return analyseClip(blob, {
      mimeType,
      sampleRate: settings?.sampleRate,
      channels: settings?.channelCount,
    })
  }

  /** Stops and discards. Safe at any time, including before start(). */
  cancel(): void {
    if (this.recorder?.state === 'recording') {
      try {
        this.recorder.stop()
      } catch {
        /* already stopping */
      }
    }
    this.chunks = []
    this.teardown()
  }

  private teardown(): void {
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
    this.recorder = null
    this.analyser = null
    this.buffer = null
    void this.context?.close().catch(() => undefined)
    this.context = null
  }
}

/* ── Measurement ─────────────────────────────────────────────────────── */

interface AnalyseHints {
  mimeType: string
  sampleRate?: number
  channels?: number
}

/**
 * Decodes the clip once and derives every metric from it.
 *
 * Duration comes from the decoded buffer rather than a wall-clock timer:
 * MediaRecorder WebM output frequently carries no duration in its metadata,
 * so `audio.duration` reads `Infinity` and a stopwatch includes the encoder's
 * own latency. Decoding is exact.
 *
 * Sample rate and channel count come from the *device* settings, not the
 * decoded buffer — `decodeAudioData` resamples to the AudioContext rate, so
 * the buffer would report the playback rate rather than the capture rate.
 */
export async function analyseClip(
  blob: Blob,
  hints: AnalyseHints,
  buckets = 72,
): Promise<RecordingClip> {
  const mimeType = blob.type || hints.mimeType || 'audio/webm'
  const base: RecordingClip = {
    blob,
    mimeType,
    extension: extensionFor(mimeType),
    durationS: 0,
    sampleRate: hints.sampleRate ?? 0,
    channels: hints.channels ?? 1,
    sizeBytes: blob.size,
    peak: 0,
    rms: 0,
    peaks: [],
  }

  if (blob.size === 0) return base

  const context = new AudioContext()
  try {
    const audio = await context.decodeAudioData(await blob.arrayBuffer())
    const samples = audio.getChannelData(0)

    let peak = 0
    let sumSquares = 0
    for (let i = 0; i < samples.length; i++) {
      const value = Math.abs(samples[i])
      if (value > peak) peak = value
      sumSquares += samples[i] * samples[i]
    }

    const size = Math.floor(samples.length / buckets) || 1
    const rawPeaks: number[] = []
    for (let i = 0; i < buckets; i++) {
      let bucketPeak = 0
      const start = i * size
      for (let j = 0; j < size && start + j < samples.length; j++) {
        const value = Math.abs(samples[start + j])
        if (value > bucketPeak) bucketPeak = value
      }
      rawPeaks.push(bucketPeak)
    }

    return {
      ...base,
      durationS: audio.duration,
      // Fall back to the decoded rate only if the device reported nothing.
      sampleRate: base.sampleRate || audio.sampleRate,
      channels: base.channels || audio.numberOfChannels,
      peak,
      rms: samples.length > 0 ? Math.sqrt(sumSquares / samples.length) : 0,
      peaks: peak > 0 ? rawPeaks.map((value) => value / peak) : rawPeaks,
    }
  } catch {
    // Undecodable audio is a failed recording, not a crash. Callers see a
    // zero-duration clip and `validateClip` rejects it as empty.
    return base
  } finally {
    void context.close().catch(() => undefined)
  }
}

/** Client-side gate. Nothing is uploaded until this returns null. */
export function validateClip(clip: RecordingClip): ClipProblem | null {
  if (clip.sizeBytes < MIN_CLIP_BYTES || clip.durationS === 0) return 'empty'
  if (clip.durationS < MIN_CLIP_S) return 'too-short'
  if (clip.peak < SILENCE_PEAK_THRESHOLD) return 'silent'
  if (clip.durationS > MAX_CLIP_MS / 1000 + 1) return 'too-long'
  return null
}

/** Reads the current microphone permission without prompting. */
export async function queryMicPermission(): Promise<MicPermission> {
  if (!isRecordingSupported()) return 'unavailable'
  if (!navigator.permissions?.query) return 'unknown'
  try {
    const status = await navigator.permissions.query({
      name: 'microphone' as PermissionName,
    })
    if (status.state === 'granted') return 'granted'
    if (status.state === 'denied') return 'denied'
    return 'unknown'
  } catch {
    // Firefox does not expose the microphone permission descriptor.
    return 'unknown'
  }
}
