import type { LanguageBridge } from '../lib/journey'

/**
 * The bridge: a familiar sound, then the target, then words that build on it.
 *
 *     থ  →  θ  →  think  →  three  →  through
 *
 * What this strip says, and the limit of what it says: the first step is a
 * sound the learner already makes, and it is articulated in the same place as
 * the target. That is a description of two articulations. It is not a claim
 * that anyone's first language causes anything about how they speak, and the
 * copy here — like the copy it renders — never implies one.
 *
 * For a learner whose first language is the target language there is no
 * anchor, and the strip starts at the target sound instead.
 */
export function BridgeStrip({ bridge }: { bridge: LanguageBridge }) {
  return (
    <section className="panel p-5 sm:p-6" aria-labelledby="bridge-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="bridge-heading" className="label-mono text-ink-faint">
          {bridge.anchor ? 'From a sound you know' : 'The path for this sound'}
        </h2>
        <span className="label-mono text-ink-faint">
          {bridge.steps.filter((step) => step.kind === 'word').length} words ahead
        </span>
      </div>

      <ol className="mt-4 flex flex-wrap items-center gap-x-1 gap-y-3">
        {bridge.steps.map((step, index) => (
          <li key={`${step.kind}-${step.text}`} className="flex items-center gap-1">
            <span
              className={`rounded-xl px-3 py-2 ${
                step.kind === 'native'
                  ? 'script-bengali bg-paper-2 text-2xl font-semibold text-ink'
                  : step.kind === 'target'
                    ? 'sound-text ipa bg-[var(--sound)]/10 text-2xl font-bold'
                    : 'text-lg font-semibold text-ink'
              }`}
              // The anchor is in the learner's own script; the rest is IPA or
              // English, so only the first step gets a lang attribute.
              lang={step.kind === 'native' ? bridge.native : undefined}
              title={step.note ?? undefined}
            >
              {step.text}
            </span>
            {index < bridge.steps.length - 1 && (
              <span aria-hidden="true" className="px-1 text-line-strong">
                →
              </span>
            )}
          </li>
        ))}
      </ol>

      {bridge.anchor_note && (
        <p className="mt-4 rounded-2xl bg-paper-2 p-4 text-sm leading-relaxed text-ink-soft">
          <span className="script-bengali font-semibold text-ink" lang={bridge.native}>
            {bridge.anchor}
          </span>
          {bridge.anchor_ipa && (
            <span className="ipa ml-2 text-base text-ink-soft">/{bridge.anchor_ipa}/</span>
          )}
          <span className="mt-2 block">{bridge.anchor_note}</span>
        </p>
      )}

      <p className="label-mono mt-3 text-ink-faint">
        A starting point, not a prediction — this describes where each sound is
        made, not how anyone speaks.
      </p>
    </section>
  )
}
