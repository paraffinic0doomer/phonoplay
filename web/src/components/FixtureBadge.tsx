/**
 * Discloses that a result came from a development fixture rather than the
 * analysis service. Required wherever fixture-backed numbers are shown —
 * see the header of lib/fixtures.ts.
 */
export function FixtureBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`label-mono inline-flex items-center gap-1.5 rounded-full border border-warn/40 bg-warn/10 px-2.5 py-1 text-warn ${className}`}
      title="These numbers come from a scripted development fixture. No audio was analysed."
    >
      <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
        <path
          d="M6 1.2 11 10.4H1z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="M6 4.8v2.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="6" cy="8.7" r="0.7" fill="currentColor" />
      </svg>
      Development fixture
    </span>
  )
}

/** The long-form explanation, for the results screen. */
export function FixtureNotice() {
  return (
    <div className="panel border-warn/35 bg-warn/5 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <FixtureBadge />
        <p className="text-sm text-ink-soft">
          <strong className="font-semibold text-ink">No audio was analysed.</strong> The
          analysis service is not running, so these numbers come from a scripted
          placeholder. Start the API to see real pronunciation scoring.
        </p>
      </div>
    </div>
  )
}
