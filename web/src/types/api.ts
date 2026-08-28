/**
 * PhonoPlay API contract — hand-mirrored from `api/app/schemas.py`.
 * See ARCHITECTURE.md §4. This file is the frontend's single source of truth
 * for the shape of every backend response; nothing else should describe it.
 *
 * When `schemas.py` changes, change this file in the same commit.
 */

export type SoundId = 's' | 'r' | 'l' | 'th'

export type PromptLevel = 'word' | 'sentence'

/** GET /api/sounds */
export interface TargetSound {
  id: SoundId
  ipa: string
  label: string
  description: string
}

/** GET /api/prompts */
export interface Prompt {
  id: string
  text: string
  target_sound: SoundId
  /** Expected phoneme sequence, hand-verified at build time. */
  phonemes: string[]
  /** Indices into `phonemes` that are occurrences of the target sound. */
  target_indices: number[]
  level: PromptLevel
  difficulty: number
}

/**
 * What the browser captured, measured client-side and sent with the upload.
 * The backend transcodes to 16 kHz mono WAV but preserves these values so the
 * original capture conditions are never lost.
 */
export interface ClientAudioMeta {
  mime_type: string
  duration_s: number
  sample_rate: number
  channels: number
  size_bytes: number
}

export interface AudioQuality {
  ok: boolean
  duration_s: number
  snr_db: number
  clipped: boolean
  warnings: string[]
  /** The pre-transcode capture metadata, echoed back by the backend. */
  source: ClientAudioMeta | null
}

export interface TranscriptResult {
  text: string
  asr_confidence: number
  word_match: boolean
  normalized_edit_distance: number
}

export interface PhonemeObservation {
  phoneme: string
  prob: number
}

export type OccurrenceVerdict =
  | 'on_target'
  | 'substitution'
  | 'distortion'
  | 'omission'
  | 'unclear'

export interface TargetOccurrence {
  index: number
  start_s: number
  end_s: number
  /** Goodness of Pronunciation, log domain, <= 0. */
  gop: number
  /** GOP mapped to (0, 1] via exp(GOP / tau). */
  gop_normalized: number
  /** Most likely phonemes over the aligned segment, descending. */
  observed_top: PhonemeObservation[]
  verdict: OccurrenceVerdict
}

export interface TargetAnalysis {
  target_phoneme: string
  occurrences: TargetOccurrence[]
}

export interface TimelineSegment {
  phoneme: string
  start_s: number
  end_s: number
  gop_normalized: number
}

export interface AcousticFeatures {
  f3_hz: number | null
  f3_speaker_median_hz: number | null
  spectral_centroid_hz: number | null
  sibilant_ratio: number | null
  target_duration_s: number | null
}

export type DeviationType =
  | 'none'
  | 'substitution'
  | 'distortion'
  | 'omission'
  | 'unclear'
  | 'inconclusive'

export interface Deviation {
  type: DeviationType
  label: string | null
  from: string | null
  to: string | null
  confidence: number
  /** Which independent signals voted for this deviation. Never empty. */
  evidence: string[]
  explanation: string
}

export interface Scores {
  overall: number
  target_sound: number
  /**
   * Null when the responding endpoint did not transcribe. POST /api/attempts
   * measures the target sound acoustically and leaves this unmeasured rather
   * than reporting a zero that would read as a failure.
   */
  word_accuracy: number | null
  confidence: number
}

export interface AttemptTimings {
  ingest: number
  asr: number
  acoustic: number
  total: number
}

/** POST /api/attempts, GET /api/attempts/{id} */
export interface AttemptResult {
  attempt_id: string
  prompt: Pick<Prompt, 'id' | 'text' | 'target_sound'> & { target_ipa: string }
  audio_quality: AudioQuality
  transcript: TranscriptResult
  target_analysis: TargetAnalysis
  phoneme_timeline: TimelineSegment[]
  acoustic_features: AcousticFeatures
  deviation: Deviation
  scores: Scores
  /**
   * Whether the acoustic stage actually named a sound.
   *
   * False means it measured the recording but declined to say what was
   * produced. `scores` still holds a real similarity to the target profile,
   * but presenting it as a verdict would supply the certainty the analysis
   * deliberately withheld. Branch on this before rendering a score.
   *
   * Optional because a stored attempt from before the field existed will not
   * have it; absent is treated as assessed, which is what those attempts were.
   */
  assessed?: boolean
  timings_ms: AttemptTimings
  /**
   * Frontend-only marker. True when this result came from a development
   * fixture rather than the analysis service. The UI must disclose it.
   * The backend never sets this field.
   */
  _fixture?: boolean
}

/* ── Stage 1: transcription (POST /api/analyze) ───────────────────────
 *
 * Mirrors api/app/schemas.py::TranscriptionResponse.
 *
 * This is what was SAID, not how it was PRONOUNCED. Whisper repairs
 * mispronunciations toward plausible English, so a transcript is a signal
 * about which word was attempted and says nothing reliable about phoneme
 * quality. `pronunciation_assessed` is always false and exists to make that
 * impossible to overlook. Pronunciation scoring is a separate stage.
 */

export interface TranscriptWord {
  word: string
  start: number | null
  end: number | null
}

export interface TranscriptSegment {
  id: number
  start: number
  end: number
  text: string
  words: TranscriptWord[]
  avg_logprob: number | null
  no_speech_prob: number | null
  compression_ratio: number | null
}

export interface ProcessedAudioMeta {
  probed_duration_s: number | null
  probed_sample_rate: number | null
  probed_channels: number | null
  codec: string | null
  container: string | null
  sample_rate: number
  channels: number
  duration_s: number
  size_bytes: number
  transcoded: boolean
}

export interface ProcessingMeta {
  ingest_ms: number
  transcription_ms: number
  total_ms: number
  provider: string
  model: string
}

export interface TranscriptionResponse {
  transcript: string
  /** As the provider labels it, e.g. "English". */
  language: string | null
  /** ISO-639-1 when derivable, else null. */
  language_code: string | null
  duration: number | null
  segments: TranscriptSegment[]
  audio: ProcessedAudioMeta
  source: ClientAudioMeta | null
  processing: ProcessingMeta
  stage: string
  /** Always false. See the note above. */
  pronunciation_assessed: boolean
}

/* ── Stage 2: acoustic measurement (POST /api/pronunciation) ──────────
 *
 * Mirrors api/app/schemas.py::PronunciationResponse.
 *
 * This is the only stage that produces a number. Every field below is derived
 * from the signal by `api/app/acoustic/`; none of it is influenced by the
 * transcript and none of it may come from a language model.
 *
 * The `candidates`, `segment` and `quality` blocks are evidence rather than
 * verdict: they exist so a reader can see *why* the measurement came out the
 * way it did. The Sound Lab draws its charts from them, which is what lets it
 * visualise the analysis without inventing anything.
 */

/** One phoneme the recording was compared against. */
export interface CandidateInfo {
  phoneme: string
  ipa: string
  /** exp(-½ · mean weighted squared error) against this profile, in (0, 1]. */
  similarity: number
  /** Softmax over the candidate log-likelihoods. Sums to 1 across the set. */
  posterior: number
  /** How many of this profile's features the recording supported. */
  features_used: number
  /**
   * Per-feature standardised error: `(measured - reference.mean) / reference.sd`.
   *
   * Positive means the recording measured *above* the reference average.
   * This is the field that makes a verdict auditable, and the only honest
   * basis for a "how did each measurement compare" chart — the frontend holds
   * no reference statistics of its own and must not synthesise any.
   */
  z_scores: Record<string, number>
}

/** Where in the recording the target sound was located. */
export interface SegmentInfo {
  start_s: number
  end_s: number
  duration_s: number
  /** 0–1. How clearly the landmark stood out from its surroundings. */
  salience: number
  /** How it was found, e.g. "frication-run", "voiced-onset". */
  method: string
  position_hint: string
}

/** Whether the recording could carry a measurement at all. */
export interface RecordingQuality {
  duration_s: number
  speech_duration_s: number
  snr_db: number
  clipped_fraction: number
  voiced_fraction: number
  dynamic_range_db: number
  speech_present: boolean
  ok: boolean
  /** 0–1 trust multiplier folded into `confidence`. */
  factor: number
  warnings: string[]
  blocking_code: string | null
}

/** POST /api/pronunciation. Stage 2 only — never a transcript. */
export interface PronunciationMeasurement {
  target_phoneme: string
  target_ipa: string
  /** Null when the evidence did not support naming a sound. Never guessed. */
  estimated_match: string | null
  estimated_match_ipa: string | null
  /** Gaussian similarity to the target profile, in (0, 1]. */
  similarity_score: number
  confidence: number
  /** Measured feature values, in their own units. Keys vary by sound family. */
  acoustic_features: Record<string, number>
  feedback_code: string
  /** "assessed" | "insufficient_confidence" | "unusable_audio". */
  status: string
  message: string
  /** The specific reason behind a failure headline. */
  detail: string | null
  /** A pronunciation cue, written by the deterministic feedback bank. */
  cue: string | null
  hint: string | null
  /** False whenever no phoneme was named, for any reason. Branch on this. */
  assessed: boolean
  candidates: CandidateInfo[]
  segment: SegmentInfo | null
  quality: RecordingQuality
  /** Speaker reference values used for normalisation. */
  speaker: Record<string, number>
  /** Reported for transparency, deliberately not scored on. */
  mfcc: number[]
  /** Reference corpus provenance: version, built, tokens, source, coverage. */
  reference: Record<string, unknown>
  processing_ms: number
  stage: string
}

export type ExerciseActivityType =
  | 'minimal_pairs'
  | 'word_ladder'
  | 'sentence'
  | 'isolation'

export interface ExerciseItem {
  text: string
  /** Display-only counterpart in a minimal pair. Not itself practised. */
  contrast: string | null
  target_ipa: string
  /**
   * The prompt to load when the learner practises this item. Null when the
   * word is not in the prompt bank, in which case the UI offers a fresh
   * prompt for the same sound instead of a dead end.
   */
  prompt_id: string | null
}

/** POST /api/exercises */
export interface Exercise {
  id: string
  attempt_id: string
  target_sound: SoundId
  deviation_label: string | null
  title: string
  cue: string
  activity_type: ExerciseActivityType
  items: ExerciseItem[]
  difficulty: number
  /** Whether Claude generated this or the deterministic bank did. */
  source: 'llm' | 'fallback'
  /** Frontend-only marker; see AttemptResult._fixture. */
  _fixture?: boolean
}

/** GET /api/sessions/{id}/progress */
export interface ProgressPoint {
  attempt_n: number
  score: number
  ts: string
}

export interface SessionProgress {
  by_sound: Partial<Record<SoundId, ProgressPoint[]>>
  deltas: Partial<Record<SoundId, number>>
}

export type ApiErrorCode =
  | 'AUDIO_TOO_SHORT'
  | 'AUDIO_TOO_QUIET'
  | 'AUDIO_CLIPPED'
  | 'NO_SPEECH_DETECTED'
  | 'ALIGNMENT_FAILED'
  | 'MODEL_NOT_READY'
  | 'LLM_UNAVAILABLE'
  | 'UNSUPPORTED_AUDIO_FORMAT'
  // Backend audio ingest (api/app/audio/ingest.py)
  | 'EMPTY_AUDIO'
  | 'INVALID_AUDIO'
  | 'NO_AUDIO_STREAM'
  | 'AUDIO_TOO_LARGE'
  | 'AUDIO_TOO_LONG'
  | 'TRANSCODE_FAILED'
  | 'FFMPEG_MISSING'
  // Transcription provider (api/app/stt/errors.py)
  | 'STT_NOT_CONFIGURED'
  | 'STT_AUTH_FAILED'
  | 'STT_RATE_LIMITED'
  | 'STT_TIMEOUT'
  | 'STT_UNAVAILABLE'
  | 'STT_INVALID_AUDIO'
  | 'STT_BAD_RESPONSE'
  | 'STT_FAILED'
  | 'NOT_IMPLEMENTED'
  | 'INVALID_REQUEST'
  | 'INTERNAL_ERROR'
  // Client-side conditions. Never returned by the backend, but they flow
  // through the same error channel so the UI has one way to show problems.
  | 'NETWORK_UNAVAILABLE'
  | 'UPLOAD_FAILED'
  | 'UPLOAD_TIMEOUT'
  | 'MIC_DENIED'
  | 'MIC_NOT_FOUND'
  | 'MIC_BUSY'
  | 'MIC_UNSUPPORTED'
  | 'MIC_INSECURE_CONTEXT'
  | 'RECORDING_FAILED'
  | 'RECORDING_EMPTY'
  | 'RECORDING_SILENT'
  | 'UNKNOWN'

export interface ApiErrorBody {
  code: ApiErrorCode
  message: string
  retryable: boolean
}

/** GET /api/health */
export interface HealthStatus {
  status: 'ok' | 'warming' | 'degraded'
  models: { asr: boolean; acoustic: boolean }
  version: string
}
