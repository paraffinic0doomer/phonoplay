const STEPS = ['Sound', 'Record', 'Analyse', 'Practise'] as const

export type StepName = (typeof STEPS)[number]

/**
 * Where the learner is in the core loop. Present on every screen inside the
 * loop so no screen feels like a place you can get stuck.
 */
export function Stepper({ current }: { current: StepName }) {
  const currentIndex = STEPS.indexOf(current)

  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1" aria-label="Practice progress">
      {STEPS.map((step, index) => {
        const state =
          index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming'
        return (
          <li key={step} className="flex items-center gap-2">
            <span
              className={`label-mono flex items-center gap-1.5 rounded-full px-2.5 py-1 ${
                state === 'current'
                  ? 'sound-tint-strong sound-text'
                  : state === 'done'
                    ? 'text-ink-soft'
                    : 'text-ink-faint'
              }`}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              {state === 'done' && (
                <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
                  <path
                    d="M2 6.4 4.8 9 10 3.4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
              {step}
            </span>
            {index < STEPS.length - 1 && (
              <span aria-hidden="true" className="h-px w-4 bg-line-strong sm:w-6" />
            )}
          </li>
        )
      })}
    </ol>
  )
}
