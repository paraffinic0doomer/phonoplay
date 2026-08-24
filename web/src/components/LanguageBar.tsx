import type { LanguageContext, LanguageInfo } from '../lib/journey'
import type { SoundId } from '../types/api'

/**
 * Native language / Learning / Target.
 *
 *     Native language     Learning        Target
 *     বাংলা               English         TH
 *
 * Shown only when the two languages differ. An English speaker practising
 * English has nothing to read here, and a row telling them their first
 * language is English would be noise — English-only mode stays exactly as it
 * was before this feature existed.
 */
export function LanguageBar({
  language,
  sound,
  onChange,
}: {
  language: LanguageContext
  sound: SoundId
  /** Omit to render read-only. */
  onChange?: () => void
}) {
  if (!language.cross_language) return null

  return (
    <section className="panel flex flex-wrap items-end gap-x-8 gap-y-4 p-5">
      <Field label="Native language">
        <span
          // The interface is English; only the language's own name is in its
          // own script, so the font switch is per element.
          className={`text-2xl font-semibold text-ink ${
            language.native.script === 'Bengali' ? 'script-bengali' : ''
          }`}
          lang={language.native.code}
        >
          {language.native.native_name}
        </span>
      </Field>

      <Arrow />

      <Field label="Learning">
        <span className="text-2xl font-semibold text-ink">{language.target.name}</span>
      </Field>

      <Arrow />

      <Field label="Target">
        <span className="sound-text text-2xl font-bold uppercase">{sound}</span>
      </Field>

      {onChange && (
        <button
          type="button"
          onClick={onChange}
          className="label-mono ml-auto self-center text-ink-faint underline underline-offset-2 hover:text-ink"
        >
          Change
        </button>
      )}

      {/* The limitation stays visible after the choice, not only while
          making it. It was previously rendered in the picker alone, which
          meant it disappeared at the exact moment it started to apply. */}
      {language.native.target_note && (
        <p className="w-full rounded-2xl bg-paper-2 p-4 text-xs leading-relaxed text-ink-soft">
          {language.native.target_note}
        </p>
      )}
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="label-mono text-ink-faint">{label}</span>
      {children}
    </div>
  )
}

function Arrow() {
  return (
    <span aria-hidden="true" className="self-center pb-1 text-xl text-line-strong">
      →
    </span>
  )
}

/**
 * First-language picker.
 *
 * `can_be_target: false` is surfaced here rather than hidden, because this is
 * the moment a learner would otherwise assume PhonoPlay measures their own
 * language too. It does not — the reference data is English — and saying so
 * where the choice is made is more useful than a footnote.
 */
export function LanguagePicker({
  options,
  current,
  onSelect,
  busy = false,
}: {
  options: LanguageInfo[]
  current: string
  onSelect: (code: string) => void
  busy?: boolean
}) {
  const selected = options.find((option) => option.code === current)

  return (
    <section className="panel p-5 sm:p-6">
      <h2 className="label-mono text-ink-faint">Your first language</h2>
      <p className="mt-2 text-sm text-ink-soft">
        PhonoPlay can personalize practice for learners whose first language
        differs from their target language.
      </p>

      <div role="radiogroup" aria-label="First language" className="mt-4 flex flex-wrap gap-2">
        {options.map((option) => {
          const active = option.code === current
          return (
            <button
              key={option.code}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={busy}
              onClick={() => onSelect(option.code)}
              className={`rounded-2xl border px-4 py-2.5 text-left transition-colors disabled:opacity-60 ${
                active
                  ? 'border-[var(--sound)] bg-paper-2'
                  : 'border-line bg-paper hover:border-line-strong'
              }`}
            >
              <span
                className={`block text-lg font-semibold text-ink ${
                  option.script === 'Bengali' ? 'script-bengali' : ''
                }`}
                lang={option.code}
              >
                {option.native_name}
              </span>
              {option.native_name !== option.name && (
                <span className="label-mono text-ink-faint">{option.name}</span>
              )}
            </button>
          )
        })}
      </div>

      {selected?.target_note && (
        <p className="mt-4 rounded-2xl bg-paper-2 p-4 text-xs leading-relaxed text-ink-soft">
          {selected.target_note}
        </p>
      )}
    </section>
  )
}
