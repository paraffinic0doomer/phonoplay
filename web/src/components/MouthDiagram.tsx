import type { SoundId } from '../types/api'

/**
 * Simplified side view of the mouth showing where the tongue goes for each
 * target sound. Schematic and friendly, not anatomical — its job is to make
 * "put your tongue here" legible to a child or a language learner.
 *
 * The mouth opens to the LEFT. The four tongue shapes deliberately differ in
 * where their high point sits, because that difference is the whole message:
 *   /s/  tip raised behind the top teeth
 *   /l/  tip pressed onto the ridge, touching the palate
 *   /th/ tip pushed forward, out between the teeth
 *   /r/  tip low, body bunched high at the back
 */

const TONGUE: Record<SoundId, string> = {
  s: 'M22 58 Q34 60 52 66 Q76 70 106 70 Q115 78 108 89 L26 90 Q17 76 22 58 Z',
  l: 'M30 48 Q38 57 56 66 Q78 72 106 72 Q115 80 108 89 L28 90 Q22 70 30 48 Z',
  th: 'M3 62 Q20 62 40 68 Q70 74 104 74 Q115 81 108 89 L26 90 Q11 80 3 62 Z',
  r: 'M26 77 Q40 81 56 76 Q72 62 92 54 Q109 52 113 67 Q116 81 108 89 L28 90 Q21 84 26 77 Z',
}

const DESCRIPTION: Record<SoundId, string> = {
  s: 'Side view of a mouth: the tongue tip sits just behind the top teeth with a narrow gap for air.',
  l: 'Side view of a mouth: the tongue tip presses against the ridge behind the top teeth.',
  th: 'Side view of a mouth: the tongue tip pushes forward between the top and bottom teeth.',
  r: 'Side view of a mouth: the tongue tip stays low while the body bunches up at the back.',
}

function Airflow({ sound }: { sound: SoundId }) {
  const stroke = {
    stroke: 'var(--color-ink)',
    strokeOpacity: 0.55,
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  }

  if (sound === 's') {
    // A narrow, fast stream straight out of the gap.
    return (
      <g {...stroke}>
        <path d="M20 62 H5" />
        <path d="M10 57 L4 62 L10 67" />
      </g>
    )
  }
  if (sound === 'th') {
    // Soft, diffuse, quiet air around the protruding tip.
    return (
      <g fill="var(--color-ink)" fillOpacity="0.4">
        <circle cx="6" cy="49" r="2.2" />
        <circle cx="14" cy="43" r="1.7" />
        <circle cx="23" cy="39" r="1.2" />
      </g>
    )
  }
  if (sound === 'l') {
    // Air escaping around the sides of the tongue.
    return (
      <g {...stroke}>
        <path d="M34 58 Q20 54 8 60" />
        <path d="M13 55 L7 60 L14 64" />
      </g>
    )
  }
  // /r/ — resonance in the space behind the bunched tongue.
  return (
    <g {...stroke}>
      <path d="M84 42 Q95 33 104 41 Q97 48 90 43" />
    </g>
  )
}

interface MouthDiagramProps {
  sound: SoundId
  className?: string
}

const CUE: Record<SoundId, string> = {
  s: 'Try placing your tongue approximately behind the top teeth.',
  r: 'Try placing the tongue body high at the back, with relaxed lips.',
  l: 'Try placing the tongue tip on the ridge behind the top teeth.',
  th: 'Try placing the tongue tip approximately between the teeth.',
}

export function MouthDiagram({ sound, className = '' }: MouthDiagramProps) {
  return (
    <div className={className}>
      <svg viewBox="0 0 130 110" role="img" aria-label={DESCRIPTION[sound]} className="w-full">
      {/* Oral cavity */}
      <path
        d="M12 38 Q50 25 100 31 Q123 35 123 58 L123 76 Q123 95 100 97 Q50 101 12 90 Z"
        fill="color-mix(in oklab, currentColor 13%, transparent)"
        stroke="color-mix(in oklab, currentColor 40%, transparent)"
        strokeWidth="1.6"
      />

      {/* Hard palate — the ridge the tongue reaches for */}
      <path
        d="M24 42 Q60 31 104 39"
        fill="none"
        stroke="var(--color-ink)"
        strokeOpacity="0.28"
        strokeWidth="2"
        strokeLinecap="round"
      />

      {/* Tongue */}
      <path
        d={TONGUE[sound]}
        fill="currentColor"
        stroke="var(--color-ink)"
        strokeOpacity="0.22"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />

      {/* Teeth, drawn over the tongue so /th/ reads as "between the teeth" */}
      <rect x="11" y="40" width="9" height="13" rx="2.5" fill="var(--color-ink)" opacity="0.85" />
      <rect x="11" y="74" width="9" height="13" rx="2.5" fill="var(--color-ink)" opacity="0.85" />

      <Airflow sound={sound} />
      </svg>
      <p className="mt-2 text-center text-[0.68rem] leading-snug text-ink-faint">
        <span className="block font-medium">Approximate pronunciation guide</span>
        {CUE[sound]}
      </p>
    </div>
  )
}
