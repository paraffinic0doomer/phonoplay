import { useEffect, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { SOUND_LIST } from '../data/sounds'
import type { SoundId } from '../types/api'
import { ButtonLink } from '../components/Button'
import { WaveField } from '../components/WaveField'
import { MouthDiagram } from '../components/MouthDiagram'
import { useSession } from '../state/session'
import { HowItWorks } from '../components/HowItWorks'

const STEPS = [
  {
    n: '01',
    title: 'Pick a sound',
    body: 'Choose the sound you want to work on — /S/, /R/, /L/ or /TH/ — and get a word to say.',
  },
  {
    n: '02',
    title: 'Say it out loud',
    body: 'Record yourself once. One word is enough; the whole thing takes about a second.',
  },
  {
    n: '03',
    title: 'See what came out',
    body: 'Two separate signals — what you said, and how you said it — are compared against the target sound.',
  },
  {
    n: '04',
    title: 'Practise the gap',
    body: 'You get an activity built for the exact pattern that showed up, not a generic word list.',
  },
]

const FEATURES = [
  {
    title: 'Target-sound feedback',
    body: 'Every score points at one specific sound inside the word, with the measurement it came from — never a single mystery number.',
    icon: (
      <path
        d="M4 16h3l3-9 3 13 3-8h4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    title: 'Personalized practice',
    body: 'The next activity is built from the pattern that actually showed up in your recording — contrast pairs, cues, and words that isolate it.',
    icon: (
      <>
        <circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="12" cy="12" r="2.6" fill="currentColor" />
      </>
    ),
  },
  {
    title: 'Progress you can see',
    body: 'Attempts stack up across your session so you can watch the same word get closer to target, try after try.',
    icon: (
      <path
        d="M4 18V9m5 9V5m5 13v-6m5 6V8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    ),
  },
]

export function Landing() {
  const [hovered, setHovered] = useState<SoundId | null>(null)
  const { state } = useSession()

  const accent = hovered
    ? SOUND_LIST.find((profile) => profile.id === hovered)?.color
    : 'var(--color-ink)'

  const hasHistory = state.attempts.length > 0

  /*
   * A learner who has not been through onboarding starts there; everyone else
   * goes straight to practice. The button copy does not change — the flow
   * behind it does — because "Start a Sound Lab" is the promise either way.
   *
   * Defaults to /sounds while the check is in flight, so a slow IndexedDB
   * read can never leave the primary call to action pointing at nothing.
   */
  const [startHref, setStartHref] = useState('/sounds')
  useEffect(() => {
    let cancelled = false
    // Imported dynamically so Dexie stays out of the landing page's critical
    // path. Statically importing it moved the first-paint bundle from 108 kB
    // to 146 kB gzipped for a check that only decides where one link points.
    void import('../db')
      .then(({ hasOnboarded }) => hasOnboarded())
      .then((done) => {
        if (!cancelled) setStartHref(done ? '/sounds' : '/onboarding')
      })
      .catch(() => {
        // Storage unavailable (private mode, blocked site data). The default
        // stands and practice still works — there is nothing to sign into.
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div style={{ '--sound': accent } as CSSProperties}>
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-4 pb-16 pt-12 sm:px-6 sm:pt-20">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
          <div className="animate-rise">
            <span className="label-mono inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3 py-1.5 text-ink-soft">
              <span className="sound-bg size-1.5 rounded-full" aria-hidden="true" />
              Pronunciation sandbox
            </span>

            <h1 className="mt-6 text-5xl font-bold leading-[0.98] tracking-tight text-ink sm:text-6xl lg:text-7xl">
              Train the sound.
              <br />
              <span className="sound-text transition-colors duration-300">
                Not the mistake.
              </span>
            </h1>

            <p className="mt-6 max-w-lg text-lg leading-relaxed text-ink-soft sm:text-xl">
              PhonoPlay turns your pronunciation patterns into personalized practice.
            </p>

            {/* The multilingual positioning. Placed under the existing hero
                copy rather than replacing it: the promise of the product has
                not changed, this says who it is for. */}
            <p className="mt-4 max-w-lg text-lg leading-relaxed text-ink sm:text-xl">
              Pronunciation practice shouldn&rsquo;t assume everyone learns
              English from the same starting point.
            </p>

            <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
              <span className="script-bengali text-base font-semibold text-ink" lang="bn">
                বাংলা
              </span>
              <span aria-hidden="true" className="text-line-strong">&rarr;</span>
              <span className="font-semibold text-ink">English</span>
              <span className="text-ink-faint">
                &middot; start from a sound you already make
              </span>
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <ButtonLink to={startHref} size="lg">
                Start a Sound Lab
              </ButtonLink>
              {hasHistory && (
                <ButtonLink to="/progress" variant="outline" size="lg">
                  See your progress
                </ButtonLink>
              )}
            </div>

            <p className="label-mono mt-6 text-ink-faint">
              Works in your browser · Needs a microphone
            </p>
          </div>

          {/* Live visual: the wave takes the colour of whichever sound you point at */}
          <div className="panel animate-pop overflow-hidden p-0">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <span className="label-mono text-ink-faint">Sound lab</span>
              <span className="flex gap-1" aria-hidden="true">
                <span className="size-2 rounded-full bg-line-strong" />
                <span className="size-2 rounded-full bg-line-strong" />
                <span className="sound-bg size-2 rounded-full transition-colors" />
              </span>
            </div>

            <div className="sound-text px-2 py-6 transition-colors duration-300">
              <WaveField ambient amplitude={0.55} lines={5} height={180} />
            </div>

            <div className="grid grid-cols-4 border-t border-line">
              {SOUND_LIST.map((profile) => (
                <Link
                  key={profile.id}
                  to={`/practice/${profile.id}`}
                  onMouseEnter={() => setHovered(profile.id)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(profile.id)}
                  onBlur={() => setHovered(null)}
                  style={{ '--sound': profile.color } as CSSProperties}
                  className="group flex flex-col items-center gap-1 border-r border-line px-2 py-4 last:border-r-0 transition-colors hover:bg-paper-2"
                >
                  <span className="sound-text font-mono text-xl font-semibold">
                    {profile.display}
                  </span>
                  <span className="text-xs text-ink-faint">{profile.exampleWords[0]}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────── */}
      <section className="border-y border-line bg-paper-2/60 px-4 py-16 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <h2 className="label-mono text-ink-faint">How it works</h2>
          <p className="mt-3 max-w-2xl text-2xl font-semibold leading-snug text-ink sm:text-3xl">
            One loop, four steps, about a minute per round.
          </p>

          <ol className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step) => (
              <li key={step.n} className="panel p-6">
                <span className="label-mono text-ink-faint">{step.n}</span>
                <h3 className="mt-3 text-lg font-semibold text-ink">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Target sounds ────────────────────────────────────── */}
      <section className="px-4 py-16 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="label-mono text-ink-faint">Target sounds</h2>
              <p className="mt-3 max-w-xl text-2xl font-semibold leading-snug text-ink sm:text-3xl">
                Four sounds that trip up most English learners.
              </p>
            </div>
            <ButtonLink to="/sounds" variant="outline">
              Browse all four
            </ButtonLink>
          </div>

          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {SOUND_LIST.map((profile) => (
              <li
                key={profile.id}
                style={{ '--sound': profile.color } as CSSProperties}
                className="panel flex flex-col items-center p-6 text-center"
              >
                <span className="sound-text font-mono text-4xl font-semibold">
                  {profile.display}
                </span>
                <span className="sound-text mt-4 w-24">
                  <MouthDiagram sound={profile.id} />
                </span>
                <p className="mt-4 text-sm leading-relaxed text-ink-soft">
                  {profile.description}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────── */}
      <section className="px-4 pb-4 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <HowItWorks />
        </div>
      </section>

      {/* ── Starting points ──────────────────────────────────────
          The multilingual feature, shown rather than described. The
          progression is the real one from the API (api/app/languages.py);
          it is hard-coded here only because the landing page is public and
          makes no authenticated calls. */}
      <section className="border-t border-line px-4 py-16 sm:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="label-mono text-ink-faint">Different starting points</p>
          <h2 className="mt-3 text-3xl font-bold leading-tight text-ink sm:text-4xl">
            Start from a sound you already make.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-ink-soft">
            If you speak Bangla, your tongue already goes to your teeth for
            <span className="script-bengali mx-1.5 font-semibold text-ink" lang="bn">
              থ
            </span>
            &mdash; the same place English
            <span className="mx-1 font-mono font-semibold text-ink">/θ/</span>
            uses. PhonoPlay builds the practice out from there.
          </p>

          <ol
            className="mt-8 flex flex-wrap items-center justify-center gap-x-1 gap-y-3"
            aria-label="Example progression from থ to through"
          >
            {[
              { text: 'থ', bengali: true },
              { text: 'θ', target: true },
              { text: 'think' },
              { text: 'three' },
              { text: 'through' },
            ].map((step, index, all) => (
              <li key={step.text} className="flex items-center gap-1">
                <span
                  className={
                    step.bengali
                      ? 'script-bengali rounded-xl bg-paper-2 px-3 py-2 text-2xl font-semibold text-ink'
                      : step.target
                        ? 'rounded-xl bg-paper-2 px-3 py-2 font-mono text-2xl font-bold text-ink'
                        : 'px-2 text-lg font-semibold text-ink'
                  }
                  lang={step.bengali ? 'bn' : undefined}
                >
                  {step.text}
                </span>
                {index < all.length - 1 && (
                  <span aria-hidden="true" className="px-1 text-line-strong">
                    &rarr;
                  </span>
                )}
              </li>
            ))}
          </ol>

          <p className="label-mono mx-auto mt-6 max-w-xl text-ink-faint">
            A starting point, not a prediction. PhonoPlay measures English
            sounds against English reference audio, whoever is speaking.
          </p>
        </div>
      </section>

      {/* ── Feature trio ─────────────────────────────────────── */}
      <section className="border-t border-line px-4 py-16 sm:px-6">
        <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <article key={feature.title} className="panel p-7">
              <span
                aria-hidden="true"
                className="flex size-11 items-center justify-center rounded-2xl bg-ink text-paper"
              >
                <svg width="22" height="22" viewBox="0 0 24 24">{feature.icon}</svg>
              </span>
              <h3 className="mt-5 text-xl font-semibold text-ink">{feature.title}</h3>
              <p className="mt-2 text-[0.95rem] leading-relaxed text-ink-soft">
                {feature.body}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* ── Closing CTA ──────────────────────────────────────── */}
      <section className="px-4 pb-20 sm:px-6">
        <div className="panel mx-auto flex max-w-6xl flex-col items-center gap-6 overflow-hidden px-6 py-12 text-center sm:px-10">
          <div className="w-full max-w-md text-ink">
            <WaveField ambient amplitude={0.4} lines={3} height={72} />
          </div>
          <h2 className="max-w-xl text-3xl font-bold leading-tight text-ink sm:text-4xl">
            Pick a sound and say one word.
          </h2>
          <p className="max-w-md text-ink-soft">
            That is the whole first step. The lab does the rest.
          </p>
          <ButtonLink to={startHref} size="lg">
            Start a Sound Lab
          </ButtonLink>
        </div>
      </section>
    </div>
  )
}
