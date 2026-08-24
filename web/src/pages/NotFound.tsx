import { ButtonLink } from '../components/Button'
import { WaveField } from '../components/WaveField'

export function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-20 text-center sm:px-6">
      <div className="text-ink-faint">
        <WaveField ambient amplitude={0.22} lines={3} height={72} />
      </div>
      <h1 className="mt-6 text-4xl font-bold tracking-tight text-ink sm:text-5xl">
        That page is silent
      </h1>
      <p className="mx-auto mt-4 max-w-md text-lg leading-relaxed text-ink-soft">
        There is nothing to hear here. Pick a sound and start practising instead.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <ButtonLink to="/sounds" size="lg">
          Choose a sound
        </ButtonLink>
        <ButtonLink to="/" variant="outline" size="lg">
          Back home
        </ButtonLink>
      </div>
    </div>
  )
}
