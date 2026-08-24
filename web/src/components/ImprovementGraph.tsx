export interface GraphPoint {
  attempt: number
  score: number
  word: string
}

interface ImprovementGraphProps {
  points: GraphPoint[]
  className?: string
}

// Deliberately large: the SVG scales to its container, so a bigger
// viewBox keeps the labels visually small at typical widths.
const W = 640
const H = 300
const PAD_X = 54
const PAD_TOP = 36
const PAD_BOTTOM = 54

/**
 * Attempt-over-attempt pronunciation score. Hand-drawn SVG rather than a
 * charting library — it is one series, and it should look like PhonoPlay
 * rather than like a dashboard.
 */
export function ImprovementGraph({ points, className = '' }: ImprovementGraphProps) {
  if (points.length === 0) {
    return (
      <div className={`flex h-44 items-center justify-center rounded-2xl bg-paper-2 px-6 text-center text-sm text-ink-faint ${className}`}>
        Your scores will appear here after your first attempt.
      </div>
    )
  }

  const plotW = W - PAD_X * 2
  const plotH = H - PAD_TOP - PAD_BOTTOM

  const x = (i: number) =>
    points.length === 1 ? PAD_X + plotW / 2 : PAD_X + (i / (points.length - 1)) * plotW
  const y = (score: number) => PAD_TOP + plotH * (1 - Math.max(0, Math.min(100, score)) / 100)

  const line = points.map((point, i) => `${i === 0 ? 'M' : 'L'}${x(i)} ${y(point.score)}`).join(' ')
  const area =
    points.length > 1
      ? `${line} L${x(points.length - 1)} ${PAD_TOP + plotH} L${x(0)} ${PAD_TOP + plotH} Z`
      : ''

  const first = points[0].score
  const last = points[points.length - 1].score
  const delta = Math.round(last - first)

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Pronunciation score across ${points.length} attempt${points.length === 1 ? '' : 's'}, from ${first} percent to ${last} percent.`}
      >
        {/* Reference lines at 0 / 50 / 100 */}
        {[0, 50, 100].map((value) => (
          <g key={value}>
            <line
              x1={PAD_X}
              x2={W - PAD_X}
              y1={y(value)}
              y2={y(value)}
              stroke="var(--color-line)"
              strokeWidth="1"
              strokeDasharray={value === 0 ? undefined : '5 7'}
            />
            <text
              x={PAD_X - 14}
              y={y(value) + 5}
              textAnchor="end"
              className="fill-[var(--color-ink-faint)] font-mono"
              fontSize="14"
            >
              {value}
            </text>
          </g>
        ))}

        {area && <path d={area} fill="var(--sound, var(--color-ink))" opacity="0.1" />}
        {points.length > 1 && (
          <path
            d={line}
            fill="none"
            stroke="var(--sound, var(--color-ink))"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="animate-rise"
          />
        )}

        {points.map((point, i) => (
          <g key={`${point.attempt}-${i}`}>
            <circle
              cx={x(i)}
              cy={y(point.score)}
              r="8"
              fill="var(--color-paper)"
              stroke="var(--sound, var(--color-ink))"
              strokeWidth="4"
            />
            <text
              x={x(i)}
              y={y(point.score) - 17}
              textAnchor="middle"
              className="fill-[var(--color-ink)] font-semibold"
              fontSize="18"
            >
              {point.score}%
            </text>
            <text
              x={x(i)}
              y={H - 18}
              textAnchor="middle"
              className="fill-[var(--color-ink-faint)] font-mono"
              fontSize="14"
            >
              {point.attempt}
            </text>
          </g>
        ))}
      </svg>

      {points.length > 1 && (
        <p className="mt-2 text-center text-sm text-ink-soft">
          <span
            className={`font-semibold ${delta > 0 ? 'text-good' : delta < 0 ? 'text-bad' : 'text-ink-soft'}`}
          >
            {delta > 0 ? `+${delta}` : delta}
            {' points'}
          </span>{' '}
          from your first attempt to your latest.
        </p>
      )}
    </div>
  )
}
