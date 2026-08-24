const LABEL: Record<number, string> = {
  1: 'Gentle',
  2: 'Medium',
  3: 'Challenging',
}

export function DifficultyDots({
  level,
  className = '',
}: {
  level: number
  className?: string
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span className="flex gap-1" aria-hidden="true">
        {[1, 2, 3].map((step) => (
          <span
            key={step}
            className={`size-2 rounded-full ${
              step <= level ? 'sound-bg' : 'bg-line-strong'
            }`}
          />
        ))}
      </span>
      <span className="label-mono text-ink-faint">
        {LABEL[level] ?? 'Unrated'}
      </span>
    </span>
  )
}
