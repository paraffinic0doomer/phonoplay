import type { AppError } from '../state/session'
import { Button } from './Button'

/**
 * Every error the learner can hit gets a plain-language message and at least
 * one way forward. No error state is ever a dead end.
 */
const COPY: Record<string, { title: string; help: string }> = {
  MIC_DENIED: {
    title: 'The microphone is blocked',
    help: 'Your browser is refusing microphone access. Open the padlock icon in the address bar, allow the microphone, then try again.',
  },
  MIC_NOT_FOUND: {
    title: 'No microphone found',
    help: 'We could not find a microphone on this device. Plug one in or check your system sound settings, then try again.',
  },
  MIC_BUSY: {
    title: 'The microphone is busy',
    help: 'Another app is using the microphone. Close it — video calls are the usual culprit — and try again.',
  },
  MIC_UNSUPPORTED: {
    title: 'This browser cannot record',
    help: 'Audio recording is not available here. Try Chrome, Edge, Firefox, or Safari.',
  },
  MIC_INSECURE_CONTEXT: {
    title: 'Recording needs a secure connection',
    help: 'Browsers only allow microphone access over https, or on localhost. Open PhonoPlay on a secure address and try again.',
  },
  MIC_UNAVAILABLE: {
    title: 'No microphone found',
    help: 'This browser cannot record audio. Try Chrome, Edge, or Firefox on a device with a microphone.',
  },
  RECORDING_FAILED: {
    title: 'The recording stopped',
    help: 'Something interrupted the recording — often the microphone being unplugged. Try once more.',
  },
  RECORDING_EMPTY: {
    title: 'Nothing was recorded',
    help: 'That recording came out empty. Hold on a moment longer, say the word, then stop.',
  },
  RECORDING_SILENT: {
    title: 'We could not hear anything',
    help: 'The recording is nearly silent. Check that the right microphone is selected, move closer, and say the word again.',
  },
  UPLOAD_FAILED: {
    title: 'The upload did not go through',
    help: 'Your recording is still here. Check your connection and send it again.',
  },
  UPLOAD_TIMEOUT: {
    title: 'The upload timed out',
    help: 'Your recording is still here — the network was too slow. Try sending it again.',
  },
  UNSUPPORTED_AUDIO_FORMAT: {
    title: 'That audio format was rejected',
    help: 'The service could not read the recording your browser produced. Try a different browser.',
  },
  AUDIO_TOO_SHORT: {
    title: 'That was a little short',
    help: 'Hold the button and say the whole word, then release.',
  },
  AUDIO_TOO_QUIET: {
    title: 'That was very quiet',
    help: 'Move closer to the microphone and say the word again at a normal volume.',
  },
  AUDIO_CLIPPED: {
    title: 'That was very loud',
    help: 'Move back from the microphone a little and try again.',
  },
  NO_SPEECH_DETECTED: {
    title: 'No speech detected',
    help: 'We could not hear a word in that recording. Try once more.',
  },
  ALIGNMENT_FAILED: {
    title: 'That one did not line up',
    help: 'The recording could not be matched to the word. Try saying just the word on its own.',
  },
  MODEL_NOT_READY: {
    title: 'The sound lab is still warming up',
    help: 'The analysis models are loading. Give it a few seconds and try again.',
  },
  NETWORK_UNAVAILABLE: {
    title: 'Cannot reach the analysis service',
    help: 'The API is not responding. Check that the backend is running, then try again.',
  },
  LLM_UNAVAILABLE: {
    title: 'Could not build a new challenge',
    help: 'Your score is still valid. You can practise the same word again.',
  },
}

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
  const copy = COPY[error.code] ?? {
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
