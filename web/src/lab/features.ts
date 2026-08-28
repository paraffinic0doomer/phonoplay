import type { CandidateInfo, PronunciationMeasurement, SegmentInfo } from '../types/api'

/**
 * Turning the acoustic stage's evidence into something a learner can look at.
 *
 * Everything here is presentation of numbers that already exist. Nothing in
 * this file computes, interpolates, smooths or invents a measurement — that
 * would put a fabricated shape on a screen that claims to show real audio, and
 * the Sound Lab's whole value is that it does not do that.
 *
 * The two things it presents:
 *
 *   1. `candidates[]` — every phoneme the recording was compared against, with
 *      the similarity and posterior the classifier produced for each. A bar
 *      chart of these is a direct rendering of the comparison.
 *
 *   2. `candidates[].z_scores` — per-feature standardised error against the
 *      reference profile, `(measured - mean) / sd`. This is the *only* honest
 *      basis for a "how did each measurement compare" chart, because the
 *      frontend holds no reference statistics of its own. It must never derive
 *      a reference mean and draw it as if it had one.
 *
 * The anti-pattern this replaces is in components/SoundCompare.tsx, which
 * expands two scalars into eighteen spectrum bars through a formula. Those
 * bars look like a spectrum and are not one.
 */

/** How the value is written out, so a reader knows what they are looking at. */
type Unit = 'hz' | 'db' | 'db_per_khz' | 'hz_per_s' | 's' | 'ratio'

interface FeatureCopy {
  /** Learner-facing name. Short enough to sit in a chart row. */
  label: string
  /** One line on what the measurement is, for the details disclosure. */
  about: string
  unit: Unit
}

/**
 * Every feature the reference profiles score on, in learner-facing words.
 *
 * Keyed to `api/app/acoustic/reference/profiles.json`. A `z_scores` entry only
 * exists for a feature that profile carries, so this table and that file are
 * the same closed set — and a test asserts it, because an unlabelled feature
 * would silently vanish from the chart rather than fail loudly.
 *
 * The wording avoids anatomy and avoids verdicts. "Where the energy sat" is
 * something a microphone can establish; "your tongue was too far back" is not.
 */
export const FEATURE_COPY: Record<string, FeatureCopy> = {
  /* Fricatives — /s/ and /th/ are measured on the shape of the noise. */
  centroid_hz: {
    label: 'Where the energy sat',
    about: 'The average frequency of the sound, weighted by how loud each part was.',
    unit: 'hz',
  },
  peak_hz: {
    label: 'Strongest frequency',
    about: 'The single frequency carrying the most energy.',
    unit: 'hz',
  },
  rolloff85_hz: {
    label: 'Top of the energy',
    about: 'The frequency below which 85% of the energy sat.',
    unit: 'hz',
  },
  bandwidth_hz: {
    label: 'Spread of the energy',
    about: 'How widely the energy was spread around its centre.',
    unit: 'hz',
  },
  flatness: {
    label: 'How noise-like it was',
    about: 'Near 1 is even hiss across the range; near 0 is energy concentrated in peaks.',
    unit: 'ratio',
  },
  tilt_db_per_khz: {
    label: 'High against low',
    about: 'Whether energy rose or fell as frequency went up.',
    unit: 'db_per_khz',
  },
  hf_ratio: {
    label: 'Share of energy up high',
    about: 'How much of the total energy sat in the upper frequencies.',
    unit: 'ratio',
  },
  zcr: {
    label: 'How fast the signal alternated',
    about: 'How often the waveform crossed zero — higher for sharper hiss.',
    unit: 'ratio',
  },
  voicing: {
    label: 'Voice in the sound',
    about: 'How much vocal-fold buzz was present. These sounds are made without it.',
    unit: 'ratio',
  },
  rel_intensity_db: {
    label: 'Loudness of the sound',
    about:
      'How loud the sound was compared with the rest of your recording, not in absolute terms — so it does not depend on your microphone or how close you sat.',
    unit: 'db',
  },
  duration_s: {
    label: 'How long it lasted',
    about: 'The length of the stretch that was measured.',
    unit: 's',
  },

  /* Approximants — /r/ and /l/ are measured on resonance, not noise. */
  f1_hz: {
    label: 'First resonance (F1)',
    about: 'The lowest resonance of the vocal tract during the sound.',
    unit: 'hz',
  },
  f2_hz: {
    label: 'Second resonance (F2)',
    about: 'The second resonance. Moves with the body of the tongue.',
    unit: 'hz',
  },
  f3_hz: {
    label: 'Third resonance (F3)',
    about: 'The third resonance. A low F3 is the clearest marker of an English R.',
    unit: 'hz',
  },
  f3_minus_f2_hz: {
    label: 'Gap between F2 and F3',
    about: 'How close the second and third resonances came together.',
    unit: 'hz',
  },
  f3_over_speaker_f3: {
    label: 'F3 against your own voice',
    about:
      'Your F3 during the sound, divided by your F3 across the whole recording — so the reading works the same for any voice.',
    unit: 'ratio',
  },
  f2_over_speaker_f3: {
    label: 'F2 against your own voice',
    about: 'Your F2 during the sound, scaled the same way.',
    unit: 'ratio',
  },
  f2_slope_hz_per_s: {
    label: 'How F2 moved',
    about: 'Whether the second resonance rose or fell across the sound.',
    unit: 'hz_per_s',
  },
  mid_dip_db: {
    label: 'Dip in the middle',
    about: 'How much the energy dropped during the sound compared with either side.',
    unit: 'db',
  },
  release_flux: {
    label: 'How sharply it opened',
    about: 'How quickly the sound changed as it released into the vowel.',
    unit: 'ratio',
  },
}

/** Written form of a measured value. Absolute, exactly as measured. */
export function formatFeature(key: string, value: number): string {
  const unit = FEATURE_COPY[key]?.unit
  switch (unit) {
    case 'hz':
      return `${Math.round(value).toLocaleString('en-GB')} Hz`
    case 'db':
      return `${value.toFixed(1)} dB`
    case 'db_per_khz':
      return `${value.toFixed(1)} dB/kHz`
    case 'hz_per_s':
      return `${Math.round(value).toLocaleString('en-GB')} Hz/s`
    case 's':
      return `${value.toFixed(3)} s`
    case 'ratio':
      return value.toFixed(2)
    default:
      // An unlabelled feature. Show the number rather than dropping it.
      return String(Math.round(value * 1000) / 1000)
  }
}

/* ── Standardised error ───────────────────────────────────────────────── */

/**
 * Where the chart stops drawing.
 *
 * Standardised errors are unbounded, and one feature at z = 9 would flatten
 * every other row to nothing. Anything beyond this is pinned to the edge and
 * labelled with its real value, so the clamp is visible rather than silent.
 */
export const Z_VIEW_LIMIT = 3

/** Within this many reference standard deviations counts as "in range". */
export const Z_IN_RANGE = 1

/**
 * Position across a track whose centre is the reference average.
 *
 * 0 is `-Z_VIEW_LIMIT`, 0.5 is the reference average, 1 is `+Z_VIEW_LIMIT`.
 */
export function zOffset(z: number): number {
  const clamped = Math.max(-Z_VIEW_LIMIT, Math.min(Z_VIEW_LIMIT, z))
  return (clamped + Z_VIEW_LIMIT) / (Z_VIEW_LIMIT * 2)
}

export type ZBand = 'in-range' | 'outside' | 'well-outside'

/**
 * How far out a reading sat, in three bands.
 *
 * Deliberately not good/bad. A measurement outside the reference range is a
 * difference from two reference speakers, not a fault — and CLAUDE.md rules
 * out punitive framing. The words the UI puts on these bands say where the
 * reading sat, not how the learner did.
 */
export function zBand(z: number): ZBand {
  const magnitude = Math.abs(z)
  if (magnitude <= Z_IN_RANGE) return 'in-range'
  if (magnitude <= 2) return 'outside'
  return 'well-outside'
}

export const Z_BAND_COPY: Record<ZBand, string> = {
  'in-range': 'within the reference range',
  outside: 'just outside the reference range',
  'well-outside': 'well outside the reference range',
}

/** Which side of the reference average the reading fell. */
export function zDirection(z: number): 'above' | 'below' | 'level' {
  if (z > 0.05) return 'above'
  if (z < -0.05) return 'below'
  return 'level'
}

export interface FeatureReading {
  key: string
  label: string
  about: string
  /** Standardised error against the reference profile, as measured. */
  z: number
  /** The absolute measured value, when the response carried one. */
  value: number | null
  formatted: string | null
  band: ZBand
  direction: 'above' | 'below' | 'level'
}

/**
 * The measured features, furthest from the reference first.
 *
 * Ordered by magnitude because that is the order a reader wants: the top row
 * is the measurement that moved the verdict most. Unlabelled keys are dropped
 * rather than shown raw — a chart row reading `f2_slope_hz_per_s` teaches
 * nobody anything, and the test on FEATURE_COPY stops that from happening
 * quietly.
 */
export function readFeatures(
  zScores: Record<string, number>,
  measured: Record<string, number> = {},
  limit?: number,
): FeatureReading[] {
  const readings = Object.entries(zScores)
    .filter(([key]) => key in FEATURE_COPY)
    .map(([key, z]) => {
      const value = key in measured ? measured[key] : null
      return {
        key,
        label: FEATURE_COPY[key].label,
        about: FEATURE_COPY[key].about,
        z,
        value,
        formatted: value === null ? null : formatFeature(key, value),
        band: zBand(z),
        direction: zDirection(z),
      }
    })
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))

  return limit === undefined ? readings : readings.slice(0, limit)
}

/* ── Candidates ───────────────────────────────────────────────────────── */

/**
 * The comparison against the target itself.
 *
 * `similarity_score` on the response is this candidate's similarity, so the
 * chart and the headline number cannot disagree. Null only if the analysis
 * never got as far as scoring.
 */
export function targetCandidate(
  result: Pick<PronunciationMeasurement, 'target_phoneme' | 'candidates'>,
): CandidateInfo | null {
  return result.candidates.find((c) => c.phoneme === result.target_phoneme) ?? null
}

/**
 * Candidates worth drawing, best first.
 *
 * A softmax over eight profiles leaves a long tail of near-zero posteriors
 * that costs a lot of vertical space and says nothing. The target is always
 * kept, however far down it lands, because "how did my attempt compare with
 * what I was aiming for" is the question the screen exists to answer.
 */
export function chartCandidates(
  result: Pick<PronunciationMeasurement, 'target_phoneme' | 'candidates'>,
  limit = 4,
): CandidateInfo[] {
  const ranked = [...result.candidates].sort((a, b) => b.posterior - a.posterior)
  const shown = ranked.slice(0, limit)
  if (shown.some((c) => c.phoneme === result.target_phoneme)) return shown

  const target = targetCandidate(result)
  if (!target) return shown
  // Drop the weakest to make room rather than growing the chart.
  return [...shown.slice(0, Math.max(0, limit - 1)), target]
}

/* ── The located segment ──────────────────────────────────────────────── */

/**
 * The slice of the waveform the measurement was taken from, as fractions.
 *
 * Uses the client-decoded duration rather than the segment's own, because the
 * waveform bars are drawn across that same decoded clip and the two axes have
 * to be the same axis. Returns null when there is nothing real to mark, so the
 * waveform is drawn plain instead of highlighting a guess.
 */
export function segmentHighlight(
  segment: SegmentInfo | null,
  clipDurationS: number,
): { from: number; to: number } | null {
  if (!segment || !Number.isFinite(clipDurationS) || clipDurationS <= 0) return null
  const from = segment.start_s / clipDurationS
  const to = segment.end_s / clipDurationS
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null
  return {
    from: Math.max(0, Math.min(1, from)),
    to: Math.max(0, Math.min(1, to)),
  }
}
