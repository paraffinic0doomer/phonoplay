/**
 * Reference audio for the listening tasks.
 *
 * Uses the browser's own speech synthesis. No dependency, no network call,
 * and no audio shipped in the bundle — but also no guarantee: the voices
 * available vary by platform, and some browsers have none at all.
 *
 * Nothing in the assessment depends on this working. The listening tasks are
 * scaffolding, and a learner who cannot hear the reference still records the
 * same words and gets the same profile. Every function here degrades to a
 * no-op rather than throwing.
 *
 * This is *not* the reference the analyser scores against. That is
 * `api/app/acoustic/reference/profiles.json`, measured from a fixed corpus.
 * A synthesised voice here is a demonstration for the learner's ear only.
 */

export function speechAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof SpeechSynthesisUtterance !== 'undefined'
  )
}

/** Prefer a local English voice; fall back to whatever the browser offers. */
function pickVoice(): SpeechSynthesisVoice | null {
  if (!speechAvailable()) return null
  const voices = window.speechSynthesis.getVoices()
  if (voices.length === 0) return null
  return (
    voices.find((voice) => voice.localService && voice.lang.startsWith('en')) ??
    voices.find((voice) => voice.lang.startsWith('en')) ??
    voices[0]
  )
}

/**
 * Say `text` aloud, resolving when it finishes.
 *
 * Resolves rather than rejects on every failure path — a learner pressing
 * "hear it" should never be shown an error for something optional.
 */
export function speak(text: string, rate = 0.85): Promise<void> {
  if (!speechAvailable()) return Promise.resolve()

  return new Promise((resolve) => {
    try {
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = rate
      utterance.lang = 'en-US'
      const voice = pickVoice()
      if (voice) utterance.voice = voice

      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        resolve()
      }
      utterance.onend = finish
      utterance.onerror = finish
      // Some browsers never fire `end` for short utterances. Without this the
      // button would stay disabled forever.
      window.setTimeout(finish, Math.max(1500, text.length * 140))

      window.speechSynthesis.speak(utterance)
    } catch {
      resolve()
    }
  })
}

/** Say two words with a gap, for a minimal pair. */
export async function speakPair(first: string, second: string): Promise<void> {
  await speak(first)
  await new Promise((resolve) => window.setTimeout(resolve, 450))
  await speak(second)
}

export function stopSpeaking(): void {
  if (!speechAvailable()) return
  try {
    window.speechSynthesis.cancel()
  } catch {
    /* nothing to stop */
  }
}
