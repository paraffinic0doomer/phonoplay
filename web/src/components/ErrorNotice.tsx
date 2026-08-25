import type { AppError } from '../state/session'
import { ERROR_COPY } from '../lib/errorCopy'
import { Button } from './Button'

interface ErrorNoticeProps {
  error: AppError
  onRetry?: () => void
  onDismiss?: () => void
  retryLabel?: string
}

export function ErrorNotice({
  error,
  onRetry,
  onDismiss,
  retryLabel = 'Try again',
}: ErrorNoticeProps) {
  const copy = ERROR_COPY[error.code] ?? {
    title: 'Something went wrong',
    help: error.message,
  }

  return (
    <div
      role="alert"
      className="panel animate-rise border-bad/35 bg-bad/5 p-5 sm:p-6"
    >
      <div className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-bad/15 text-bad"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6.6" stroke="currentColor" strokeWidth="1.6" />
            <path d="M8 4.6v4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <circle cx="8" cy="11.2" r="0.9" fill="currentColor" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold text-ink">{copy.title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">{copy.help}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {onRetry && error.retryable && (
              <Button size="sm" onClick={onRetry}>
                {retryLabel}
              </Button>
            )}
            {onDismiss && (
              <Button size="sm" variant="ghost" onClick={onDismiss}>
                Dismiss
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
