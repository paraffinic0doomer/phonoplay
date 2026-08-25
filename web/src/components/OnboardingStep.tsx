import type { ReactNode } from 'react'
import type { Choice } from '../onboarding/questions'

/**
 * One question, one screen.
 *
 * The shape is deliberately identical on every step — progress, a large
 * question, a set of choices, one forward action — so the flow reads as a
 * rhythm rather than a form. Nothing here is required in the way a
 * registration field is required: there is no account being created, and a
 * learner can go back and change any answer.
 */

export function StepProgress({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="label-mono text-ink-faint">
          Step {step} of {total}
        </span>
        <span className="label-mono text-ink-faint">
          {Math.round(((step - 1) / total) * 100)}%
        </span>
      </div>
      <ol
        className="flex gap-1.5"
        aria-label={`Onboarding progress: step ${step} of ${total}`}
      >
        {Array.from({ length: total }, (_, index) => {
          const position = index + 1
          const done = position < step
          const current = position === step
          return (
            <li
              key={position}
              aria-current={current ? 'step' : undefined}
              className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
                done ? 'bg-ink' : current ? 'bg-[var(--sound)]' : 'bg-line'
              }`}
            />
          )
        })}
      </ol>
    </div>
  )
}

/**
 * A choice.
 *
 * Rendered as a radio rather than a button so a screen reader announces the
 * set and the selection, and so arrow keys work the way people expect in a
 * group of alternatives.
 */
export function ChoiceCard<T extends string>({
  choice,
  selected,
  onSelect,
}: {
  choice: Choice<T>
  selected: boolean
  onSelect: (value: T) => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => onSelect(choice.value)}
      className={`group flex w-full items-center gap-4 rounded-2xl border-2 px-5 py-4 text-left transition-[border-color,background-color,transform] duration-150 active:scale-[0.99] ${
        selected
          ? 'border-[var(--sound)] bg-[var(--sound)]/8'
          : 'border-line bg-paper hover:border-line-strong'
      }`}
    >
      <span
        aria-hidden="true"
        className={`grid size-5 shrink-0 place-items-center rounded-full border-2 transition-colors ${
          selected ? 'border-[var(--sound)]' : 'border-line-strong'
        }`}
      >
        <span
          className={`size-2.5 rounded-full transition-transform duration-150 ${
            selected ? 'scale-100 bg-[var(--sound)]' : 'scale-0 bg-transparent'
          }`}
        />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2.5">
          {choice.nativeLabel && (
            <span
              className="script-bengali text-xl font-semibold text-ink"
              // The label is in the language's own script; naming it lets a
              // screen reader switch voice rather than spell it out.
              lang={choice.value}
            >
              {choice.nativeLabel}
            </span>
          )}
          <span className="text-lg font-semibold text-ink">{choice.label}</span>
        </span>
        {choice.detail && (
          <span className="mt-0.5 block text-sm leading-relaxed text-ink-soft">
            {choice.detail}
          </span>
        )}
      </span>
    </button>
  )
}

/**
 * The frame every step shares.
 *
 * `key`ing this on the step index in the parent is what makes the entrance
 * animation replay on each question — a small cue that something changed,
 * which matters when the layout is otherwise identical screen to screen.
 * `animate-rise` is already reduced-motion aware globally.
 */
export function StepFrame({
  step,
  total,
  title,
  subtitle,
  children,
  footer,
}: {
  step: number
  total: number
  title: string
  subtitle?: string
  children: ReactNode
  footer: ReactNode
}) {
  return (
    <div className="flex min-h-[calc(100dvh-8rem)] flex-col">
      <StepProgress step={step} total={total} />

      <div key={step} className="animate-rise mt-10 flex-1">
        <h1 className="text-3xl font-bold leading-tight tracking-tight text-ink sm:text-4xl">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-3 max-w-lg text-base leading-relaxed text-ink-soft">
            {subtitle}
          </p>
        )}
        <div className="mt-8">{children}</div>
      </div>

      <div className="sticky bottom-0 mt-8 flex flex-wrap items-center gap-3 border-t border-line bg-paper/90 py-5 backdrop-blur-sm">
        {footer}
      </div>
    </div>
  )
}
