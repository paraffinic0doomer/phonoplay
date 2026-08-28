# PhonoPlay

An educational pronunciation practice tool. A learner picks a target sound,
records themselves saying a word, and gets a measurement of how that sound
was produced along with something to try next.

> **PhonoPlay provides educational pronunciation feedback and is not a medical
> diagnosis.**
>
> It does not diagnose, assess, or treat any speech, language, hearing, or
> developmental condition. If you have concerns about a child's speech, a
> qualified speech-language professional is the right place to take them —
> they can draw on far more evidence than a two-second recording.

Four target sounds: **/s/, /r/, /l/, /th/**. Two languages: **English** as the
target, **English or Bangla** as a learner's first language.

---

## Contents

- [What it does](#what-it-does)
- [Your recordings](#your-recordings)
- [What we store](#what-we-store)
- [Limitations](#limitations) ← **read this one**
- [Running it](#running-it)
- [Testing](#testing)
- [Architecture](#architecture)

---

## What it does

Four steps behind every result:

**1. Audio is analyzed.** The recording is measured for loudness, background
noise, clipping, and where the target sound sits in it. If it cannot support a
result, PhonoPlay stops here and says so.

**2. Speech recognition provides linguistic context.** A speech-to-text model
reports which words it recognised. This is context, not a pronunciation
score — speech-to-text corrects mispronunciations toward real words, so a
clean transcript does not mean a clean /r/.

**3. Acoustic features help estimate pronunciation similarity.** Measurements
from the recording — where the sound's energy sits, how loud and how long it
is, where the tongue shaped it — are compared against reference recordings.
The result is a similarity estimate, not a verdict.

**4. AI generates practice material.** A language model writes the next
exercise. It never sees the recording and never decides how the learner did.

Steps 2 and 3 are deliberately separate stages with separate endpoints,
separate models, and separate response schemas. They answer different
questions from the same audio, and merging them would make it easy to read a
transcript as evidence about a phoneme.

---

## Your recordings

**Recordings are analyzed and then discarded.** PhonoPlay keeps the
measurements, never the audio.

Where audio actually goes, per stage — stated separately because the answers
genuinely differ:

| Stage | Does audio leave the browser? | What happens |
|---|---|---|
| **Pronunciation analysis** | **Yes** | Sent to the PhonoPlay analysis service, measured, then discarded when the request ends. |
| **Speech recognition** | **Yes** | The older speech-recognition flow sends audio to **Groq**, a third-party service for a transcript. The transcript is never a pronunciation score. |
| **Practice material** | No | The generator receives text only — the sound, the stage, the language. Never a recording, never a score. |

To keep audio entirely on your own infrastructure, set `STT_PROVIDER=fake`.
You lose step 2 and nothing else; the pronunciation measurement is unaffected.

**On disk:** exactly one transient file per request. `ffprobe` cannot seek a
pipe, so the upload is spilled to a temp file and removed in a `finally`
block. Nothing else touches the filesystem. A test asserts the file is gone
even when the request raises.

---

## What we store

Practice settings and derived outcomes are stored in this browser only.

**Not collected:** name, email, address, phone number, age, date of birth,
gender, school, location, or any account. None of it is asked for, and there
is no field for it.

The database has **no raw-audio field**, so recordings cannot be persisted by
the normal learner-data path. A transcript may be kept locally by the older
speech-recognition screen as context, never as pronunciation evidence.

**Sensitive characteristics are not inferred.** PhonoPlay does not estimate
age, sex, accent, or origin, and does not report anything that would invite
someone else to. Pitch (f0) is computed internally because the segmenter needs
per-frame voicing, but it is **not reported** — it is unused by the scoring
model and is the most age- and sex-correlated number the stage can produce.
Vocal-tract formant medians *are* reported, because they are the denominator
that normalises F2 and F3; they are a measurement input with no
interpretation attached.

Clearing your browser data ends the journey. There is nothing to recover and
nothing held elsewhere.

---

## Limitations

The honest list. Numbers come from `api/scripts/evaluate.py`; the fuller
version is in [`api/app/acoustic/reference/README.md`](api/app/acoustic/reference/README.md).

### The reference data is small and synthetic

Reference profiles are built from **288 tokens of synthesised speech — two
Windows text-to-speech voices**, both adult. That is the single biggest
limitation and most of the others follow from it.

**There are no children in the reference data.** Children's formants sit
several hundred Hz above adults'. PhonoPlay is designed for children and is
least reliable for them. Speaker normalisation removes some of this, not all.

Synthesised speech is also cleaner and more canonically articulated than a
learner in a room with a laptop microphone.

### Per-sound accuracy

| Target | Correct productions | Substitutions correctly rejected |
|---|---|---|
| **/s/** | 36/36 | /θ/, /ʃ/, /t/ — **never** reported as /s/ |
| **/r/** | 36/36 | /w/ — **never** reported as /r/ |
| **/l/** | 27/36 | /r/ — never reported as /l/ |
| **/th/** | 18/36 (+7 uncertain) | /s/, /t/ — never reported as /θ/ |

- **/l/ versus /w/ is unreliable.** 15 of 36 /w/ tokens are reported as /l/.
  An l→w pattern will often be missed.
- **/θ/ versus /f/ is genuinely hard**, for people too. 11 of 36 /θ/ tokens
  read as /f/. Confidence is lower here (0.72 against 0.98 for /s/), which is
  correct behaviour but not a solution.
- **Errors are speaker-dependent.** /l/ failures split *within* words across
  the two voices, which means the boundary is being set by speaker identity
  rather than by the sound.
- **These figures are in-sample.** The profiles were built from that corpus.
  Held-out behaviour is covered by separate test fixtures.

### Confidence detects bad recordings, not close calls

Raising the confidence floor from 0.45 to 0.70 moves precision only from
86.7% to 88.2% while discarding 12% of attempts. Confidence works well for
what its quality and salience terms measure — noise, clipping, no speech, no
locatable target — and is only weakly predictive of which of two *similar*
phonemes was produced.

### The target sound is estimated, not aligned

There is no forced aligner. Landmark detection finds where the target
probably is, from the signal. A proper aligner (wav2vec2 CTC +
`torchaudio.forced_align`) is the documented upgrade path — see
[`ARCHITECTURE.md`](ARCHITECTURE.md) §3.

Consequences: only **word-initial** sounds are practised in the journey, and
at the phrase and sentence stages only the **first occurrence** is measured.

### Bandwidth

Audio is processed at 16 kHz, so everything above 8 kHz is invisible. Real
/s/ energy extends past 10 kHz. Every spectral figure is a band-limited
measurement, and the reference profiles are stated for that band rather than
copied from wideband literature.

### Multilingual support

Two languages. Bangla can be a learner's **first** language but not a target
one — there is no Bangla acoustic reference data, and inventing one would be
fabrication. The interface itself is in English; only language names and the
bridge anchors appear in the learner's script.

The Bangla bridges describe **shared places of articulation** — that থ and
/θ/ are both made with the tongue at the teeth. They are a starting point, not
a prediction. PhonoPlay makes no claim that anyone's first language causes,
explains, or predicts how they speak, and a test scans the copy for wording
that would imply it.

### AI-generated material

Practice words, phrases and sentences come from a language model.

- It **cannot** produce a score. The response schema forbids unexpected
  fields, every field is a string, and generated text never reaches the
  progression policy.
- Generated material is verified in code before use: the target sound must
  actually begin the first word, or it is discarded.
- When generation fails, times out, or has no API key, a hand-written bank
  covers every stage of every sound. The app never depends on a network call.
- It can still produce a dull or oddly-chosen word. It is bounded, not
  supervised.

### What a result is not

A result is about **one recording of one sound**. It cannot distinguish a
pronunciation pattern from an accent, a regional variant, a head cold, or a
cheap microphone. It is not evidence about a person.

---

## Running it

Requires **Python 3.12+**, **Node 20+**, and **ffmpeg** on `PATH`.

```bash
# Backend
cd api
python -m venv .venv && .venv/Scripts/pip install -e ".[dev]"
cp .env.example .env          # add GROQ_API_KEY for speech recognition
.venv/Scripts/python -m uvicorn app.main:app --port 8000

# Frontend
cd web
npm install
npm run dev                   # http://localhost:5173
```

Speech recognition needs a Groq API key. Everything else — the pronunciation
measurement, the journey, the practice bank — runs without one.

**Keys are server-side only.** No key is ever sent to the browser; a test
asserts nothing leaks into an error response, and `groq.txt` and `.env` are
gitignored.

---

## Testing

```bash
cd api && .venv/Scripts/python -m pytest        # 584 tests
GROQ_LIVE_TEST=1 .venv/Scripts/python -m pytest tests/test_groq_live.py
cd web && npx tsc --noEmit -p tsconfig.app.json && npx oxlint src
```

Several suites exist specifically to keep the claims on this page true:

| Suite | What it holds to account |
|---|---|
| `test_privacy.py` | No audio survives a request; no PII field can exist; only `app/stt/` uploads audio; failures carry no score |
| `test_safety_language.py` | No clinical vocabulary in any learner-facing string |
| `test_multilingual.py` | No causal or deficit claims in bridge copy; a first language cannot change a measurement |
| `test_acoustic_analysis.py` | Held-out minimal pairs; every refusal state |
| `test_journey_material.py` | A language model cannot emit a score |

Rebuild the reference data:

```bash
powershell -File api/scripts/build_reference_corpus.ps1
api/.venv/Scripts/python api/scripts/build_reference_profiles.py
api/.venv/Scripts/python api/scripts/evaluate.py    # the accuracy table above
```

---

## Architecture

[`ARCHITECTURE.md`](ARCHITECTURE.md) covers the whole design. The sections
worth reading first:

- **§14** — the acoustic analysis: features, scoring maths, reference data
- **§15** — the Sound Journey: stages, advancement policy, persistence
- **§16** — multilingual support and why a first language cannot reach the
  measurement
- **§3** — the forced-alignment upgrade path that §14 does not implement
