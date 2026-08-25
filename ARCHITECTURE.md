# PhonoPlay — Architecture

**"Your pronunciation writes your syllabus."**

A personalized pronunciation-learning platform. A learner records themselves,
the audio is measured acoustically, and that measurement — not a language
model's opinion — decides what they practise next.

PhonoPlay is an educational pronunciation practice system. It is **not** a
medical diagnostic tool and not a replacement for a speech-language
professional.

> This document describes the system as it is built. The detailed record —
> measured accuracy figures, feature definitions, scoring maths, safety
> guarantees — lives in [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md).
> Reference-data limits are in `api/app/acoustic/reference/README.md`.

---

## Contents

1. [Shape of the system](#1-shape-of-the-system)
2. [Frontend](#2-frontend)
3. [Backend](#3-backend)
4. [Local persistence](#4-local-persistence)
5. [The learner model](#5-the-learner-model)
6. [Data flow](#6-data-flow)
7. [API](#7-api)
8. [AI pipeline](#8-ai-pipeline)
9. [Audio pipeline](#9-audio-pipeline)
10. [Deployment](#10-deployment)
11. [Known limits and debt](#11-known-limits-and-debt)

---

## 1. Shape of the system

```
┌─────────────────────────────────────────────────────────────┐
│  React SPA (Vercel)                                         │
│  landing · onboarding · assessment · practice · progress    │
│                                                             │
│  IndexedDB (Dexie)  ◄── all learner state lives here        │
└──────────────────────────┬──────────────────────────────────┘
                           │ fetch, /api/* rewrite
                           ▼
              ┌────────────────────────────────┐
              │  FastAPI (Render, Docker)      │
              │  · acoustic analysis (local)   │
              │  · audio normalisation         │
              │  · transcription (proxied)     │
              │  · practice material           │
              │  STATELESS per learner         │
              └───────────┬────────────────────┘
                          ▼  Groq: Whisper + gpt-oss-120b
```

Two properties define everything below.

**The backend holds no learner identity.** There are no accounts, no sign-in,
and no per-learner rows on the server. A recording is uploaded, measured, and
the measurement is returned; the server forgets it happened. Every profile,
attempt, score and stage lives in the browser's IndexedDB.

**Measurement and generation are separated, and the separation is enforced by
tests.** The acoustic stage produces numbers. The language model produces
words. There is no path by which generated text becomes a score.

| Layer | Technology |
|---|---|
| Frontend | React 19.2, TypeScript 6.0, Vite 8.2, Tailwind 4.3, react-router 7.18 |
| Persistence | IndexedDB via Dexie 4.4 |
| Backend | FastAPI, Python 3.12, Pydantic v2, uvicorn |
| Analysis | numpy, scipy, librosa, praat-parselmouth, soundfile |
| Audio | ffmpeg / ffprobe (external binaries) |
| AI | Groq — Whisper for speech-to-text, `openai/gpt-oss-120b` for text |
| Lint / test | oxlint, `node --test`, pytest |

No auth library, no ORM, no state manager beyond React context. 640 backend
tests and 148 frontend tests pass.

---

## 2. Frontend

```
src/
  assessment/   the baseline sitting: plan, profile arithmetic, reference audio
  practice/     practice material and feedback wording
  db/           IndexedDB — every piece of learner state (see §4)
  language/     phoneme and language knowledge, first-language pairings
  lib/          api client, recorder, safety copy, fixtures
  state/        session context, capture hook
  components/   hand-written; no component library
  pages/        one per route
```

### Routes

| Path | Screen |
|---|---|
| `/` | Landing |
| `/onboarding` | Five questions, one per screen |
| `/assessment` | Baseline sitting → pronunciation profile |
| `/sounds` | Sound selection |
| `/practice/:sound` | **Practice engine** — the main loop |
| `/attempt/:sound` | Single-attempt flow, feeds `/results` |
| `/journey/:sound` | Server-driven stage progression (see §11) |
| `/results` `/progress` `/games` | Result detail, history, word game |

### Capture

One hook owns the microphone: `state/useCapture.ts`. Permission, start, stop,
validation, teardown and error mapping live there, so every screen that
records behaves identically and reports identical codes for identical
failures. Before it existed, Practice and Journey each had their own copy and
the two had drifted — one reported a too-long recording under the code
`AUDIO_TOO_SHORT`, the other reported a too-short one as `RECORDING_EMPTY`.

Audio never reaches persistent storage. A clip is held in memory, uploaded on
an explicit second action, and dropped. Nothing in IndexedDB can hold a Blob;
a browser test asserts it.

---

## 3. Backend

```
app/
  acoustic/    stage 2 — the pronunciation measurement (13 modules)
  stt/         stage 1 — speech-to-text behind a provider interface
  audio/       ffmpeg ingest and normalisation
  journey/     stages, advancement policy, material generation
  llm/         exercise generation
  routers/     analyze, pronunciation, attempts, exercises, catalog,
               progress, journey, health
  data/        hand-written prompt bank
```

`app/stt/` is a provider abstraction: `SpeechToTextProvider` with a Groq
implementation and a `fake` one for offline use. `groq_provider.py` is the
only module in the codebase that names Groq for transcription — a test parses
every file with `ast`, ignores docstrings and comments, and fails if anything
else reaches past the abstraction.

The API key never leaves the server. It travels as an `Authorization` header,
never a query string, and is asserted absent from every success payload and
from all eight error statuses. The browser bundle *does* contain the string
"Groq" — that is the privacy disclosure naming who receives the audio.

---

## 4. Local persistence

CLAUDE.md rules out Supabase, Postgres, Firebase, MongoDB, authentication and
user accounts. The application works immediately, with no registration, and
every learner's data stays on their own device.

`PhonoPlayDB`, schema version 2, eight tables:

| Table | Holds |
|---|---|
| `settings` | One row: languages, level, goal, learning mode |
| `phonemeProfiles` | One row per phoneme — the learner model (§5) |
| `contrastProfiles` | One row per minimal pair |
| `syllabi` / `syllabusItems` | Plan and its items |
| `practiceSessions` / `attempts` | What was practised and how it went |
| `contrastAttempts` | Individual perception answers |

**No table has a column that can hold audio.** That is structural, not a
convention.

Everything goes through `src/db/index.ts`. The UI performs no raw IndexedDB
operations; if a screen needs something the barrel does not export, that is a
missing service function rather than a reason to reach past the layer.

### Migrations

Version 2 added `contrastProfiles` and the `consistency` field, and renamed
the first stage (`isolated` → `sound`) and the flat trend (`steady` →
`stable`). The transform is a named, exported, unit-tested function rather
than an inline callback: a migration runs once per learner, on data that
cannot be regenerated, which makes it the worst possible place for an
untested branch. It is idempotent, backfills `consistency: 0` rather than 1
(a v1 row carries no evidence of spread), and leaves everything else
untouched.

---

## 5. The learner model

The half of "your pronunciation writes your syllabus" that does the writing.
`src/db/phonemes.ts` and `src/db/policy.ts`.

Per phoneme: `masteryScore`, `confidence`, `recentScores`, `consistency`,
`trend`, `attempts`, `currentStage`, `repetitionCount`, `contrastAccuracy`,
`lastPracticed`.

Per minimal pair: `attempts`, `correctAttempts`, `accuracy`, `trend`. Pairs
are tracked separately because a learner can separate /r/ from /w/ reliably
while still confusing /r/ with /l/, and averaging those into one number per
sound hides the distinction that decides what to practise.

### What the model refuses to conclude

- **Mastery from one good attempt.** One recording can produce a
  `masteryScore` of 0.97 — it is the honest estimate from one reading — and
  it is not mastery. `assessMastery` requires enough attempts, a high enough
  score, measurements the analyser stood behind, *and* scores that agree with
  each other. Score and verdict are deliberately separate.
- **A direction from two data points.** Trend is `new` below three assessed
  attempts rather than claiming a stability nobody has observed.
- **Anything from a refused recording.** Silence, noise and clipping update
  `lastPracticed` and nothing else. A refusal is evidence about the room, not
  about the learner.

### Trend

A straight line is fitted to the recent scores; its rise gives the direction
and the scatter left over says whether to believe it. Both halves matter:

- Direction has to come first. Checking spread first calls
  `0.4 → 0.6 → 0.8` inconsistent, because a learner who is steadily improving
  has a wide spread *by definition*.
- Direction has to be trusted second. Comparing the older half of the window
  against the newer half is fooled by phase — scores alternating 0.2 and 0.9
  that happen to end high produce a half-mean difference of +0.23 and read as
  "improving". Somebody who cannot reproduce a sound twice running is not
  improving.

Measured: genuine ramps leave a residual of 0.00–0.02, oscillations 0.29–0.31.
The threshold at 0.12 sits in a wide empty gap.

### Modes

Policies are plain data, selected by learning mode, so a product decision can
change one number rather than hunting through conditionals.

| | Standard | Accessibility |
|---|---|---|
| Ladder | sound → word → phrase → sentence | sound → syllable → minimal pair → word → phrase → sentence |
| Assessed attempts before mastery | 3 | 5 |
| Minimum consistency | 0.6 | 0.7 |
| Repetitions before advancing | 3 | 5 |
| Repetitions before offering help | 8 | 16 |
| Minimum mastery score | 0.75 | **0.75 — unchanged** |

Accessibility Mode asks for **more evidence** and shows **far more patience**.
It does not ask for a higher score: raising that bar would mean demanding more
of the learners the mode exists to support. What is raised is how much
evidence is needed before the score is believed.

The ladders differ in order, not only in length — Accessibility puts minimal
pairs *before* whole words, so the contrast is heard before it has to be
produced inside a word. Switching modes keeps what a learner has earned and
claims nothing more.

**Nothing moves a learner backwards.** A poor run leaves the stage where it
is. Being sent down a rung for a bad day is punitive, and CLAUDE.md rules that
out.

---

## 6. Data flow

### Onboarding → baseline → profile

```
five questions (first language, target, comfort, reason, mode)
  → settings written to IndexedDB
  → baseline assessment
      Standard:      8 word prompts, two per sound
      Accessibility: the same 8, reached through listen / repeat /
                     minimal-pair steps — 22 smaller steps in total
      each recording → POST /api/pronunciation → real measurement
      each result    → recordMeasurement() → the learner model
  → pronunciation profile: a percentage per sound, and a first focus
```

A sound with no usable recording shows **—**, never 0%. A low-confidence score
is shown but labelled, and is never chosen as the first focus. If nothing was
measured confidently, no focus is named at all.

### The practice loop

```
today's mission → learn → listen → record → analyse → feedback → retry
  → recordMeasurement() updates mastery, consistency, trend, repetitions
  → assessStage() decides whether the evidence supports the next rung
  → continue
```

### The one-way rule

```
audio ──► acoustic analysis ──► learner model ──► what to practise next
                                      │
                                      ▼
                                     LLM  ──► exercise text
                                      │
                                      ✗ never flows back into a score
```

The language model reads the learner model and writes content. It never writes
a measurement.

---

## 7. API

Everything under `/api`. No route carries a learner identity, and no route
requires authentication, because there is nothing to authenticate.

| Method | Path | Notes |
|---|---|---|
| POST | `/api/analyze` | Stage 1 — transcription. Never a score. |
| POST | `/api/pronunciation` | Stage 2 — acoustic measurement |
| POST | `/api/attempts` | Combined record for the single-attempt flow |
| POST | `/api/exercises` | Practice content from the chat model |
| GET | `/api/sounds`, `/api/prompts`, `/api/prompts/{id}` | Catalogue |
| GET | `/api/journey/*`, POST `/api/journey/*` | Server-driven journey (§11) |
| GET | `/api/health`, `/api/safety` | Readiness, disclosures |

`POST /api/pronunciation` is what the assessment and practice engine use: it
takes the target sound and expected text directly, so nothing has to be
registered in advance.

```jsonc
{
  "target_phoneme": "s",
  "estimated_match": "s",        // null when the evidence named nothing
  "similarity_score": 0.9304,
  "confidence": 0.9886,
  "acoustic_features": { /* the features that decided it */ },
  "feedback_code": "ON_TARGET",
  "status": "assessed",          // | insufficient_confidence | unusable_audio
  "assessed": true
}
```

`status` is the field to branch on. It separates two things that both decline
to name a sound: audio nothing could be measured from (similarity and
confidence are a true zero) and audio that *was* measured but did not support
a verdict (real numbers, no classification). A caller that cannot tell them
apart will either render a score for a recording nothing was measured from, or
hide evidence that exists.

`POST /api/attempts` carries `assessed` for the same reason. Before it did,
an attempt the analyser explicitly refused to classify came back with
`deviation.type: "inconclusive"` and `scores.overall: 86.9` — and the UI drew
an 87% dial for a recording the system had declined to score.

---

## 8. AI pipeline

Three surfaces, deliberately unequal in authority.

| Surface | Model | Reads | Writes | Can it affect a score? |
|---|---|---|---|---|
| Transcription | Whisper via Groq | audio | words | **No** |
| Practice material | `gpt-oss-120b` | phoneme + level | prompt text, cue | **No** |
| Exercise generation | `gpt-oss-120b` | measurement summary | explanation, words | **No** |

**The acoustic analysis is not an AI surface.** It is signal processing with a
statistical classifier over reference profiles — deterministic, inspectable,
and the only thing that produces a number.

### Guards

1. Response schemas set `extra="forbid"` — a returned `score` field fails
   validation rather than being silently ignored.
2. Every generated field is a string. There is no numeric field to fill.
3. Generated prompt text is verified in code before use: the target sound must
   actually begin the first word. Material that does not contain the sound
   being practised would corrupt the measurement.
4. A deterministic fallback bank covers every phoneme and level. No key, no
   network, a timeout, or a rejected response all fall back silently.
5. `generated_by` is stored and shown, so a learner can see whether an exercise
   came from a model or the bank.
6. **The speech-to-text model is never sent to a chat endpoint.** A test scans
   for it. `llm/exercise.py` sent `groq_model` — Whisper — to
   `/chat/completions` for its entire life; Groq returned 400, the bare
   `except` swallowed it, and the endpoint silently returned its hard-coded
   fallback on every call. Fixing the model exposed a second bug underneath:
   `max_tokens: 350` left no room for the reasoning trace `gpt-oss-120b`
   emits before its JSON, so the request died as `json_validate_failed` with
   an empty generation. A test now requires at least 800.

---

## 9. Audio pipeline

```
browser: MediaRecorder (WebM/Opus, MP4/AAC on Safari)
         8 s cap · 0.35 s floor · silence check · explicit review
              │  multipart, only after the learner consents
              ▼
server:  ffmpeg → 16 kHz mono WAV   (one temp file, deleted in `finally`)
              │
      ┌───────┴───────┐
      ▼               ▼
  stage 1          stage 2
  Groq Whisper     local DSP
  (leaves server)  (never leaves)
      │               │
      └───────┬───────┘
              ▼
   audio discarded when the request ends
```

The browser container is detected, never assumed — WebM/Opus on Chrome,
Firefox and Edge; MP4/AAC on Safari. Duration, sample rate, channels and MIME
type are measured client-side and travel with the upload, so the server keeps
three views: what the client reported, what ffprobe independently measured,
and the normalised result. Where they disagree, the server's measurement wins.

**Audio is never persisted.** One transient temp file, removed in `finally`;
no database column, local or remote, can hold it. The only transmission
off-server is stage 1 to Groq, disclosed in the UI rather than glossed.
`STT_PROVIDER=fake` removes even that, at the cost of transcription only.

There is no 2-second minimum. CLAUDE.md requires word-level practice and "sun"
is well under a second; the 0.35 s floor exists to catch a tap that captured
nothing, not to reject a short word.

### Stage 2 in one line

`preprocess → frames → quality gate → segment → features → score → feedback`

Every step can decline. A refusal returns `similarity 0.0`, `confidence 0.0`
and an empty feature set — never a small number a UI could render as a low
score.

Features are chosen per target rather than extracted blindly: fricatives are
measured on spectral shape (centroid, bandwidth, rolloff, flatness, tilt,
high-frequency ratio, ZCR), approximants on formants (F1–F3, F3 relative to
the speaker's own median, transition slope). Reference profiles are the median
of a 288-token synthesised corpus measured through the *same* code path that
scores a learner — a reference measured a different way would encode the
difference between the two paths as if it were a pronunciation error.

---

## 10. Deployment

```
Browser ──► Vercel (static SPA + /api/* rewrite) ──► Render (Docker, FastAPI)
   │                                                        │
   └──► IndexedDB (all learner state)                       └──► Groq
```

| Piece | Host | Why |
|---|---|---|
| Frontend | Vercel | static SPA, 109 kB gzipped |
| Backend | Render (Docker) | needs ffmpeg and 478 MB of scientific Python |
| AI | Groq | Whisper + chat |

**Vercel cannot host the backend** — 478 MB of dependencies against a 250 MB
function limit, plus ffmpeg as a real binary. Measured, not assumed.

The frontend reaches the API through a Vercel rewrite (`/api/:path*` →
Render): a server-to-server hop, so no browser CORS and preview deployments
work without allow-listing each generated origin.

Live: `phonoplay-sound-lab.vercel.app` → `phonoplay-api.onrender.com`.

Because the backend holds no learner state, Render's free tier spinning down
after 15 minutes costs a cold start and nothing else. Progress is in the
browser and survives regardless.

---

## 11. Known limits and debt

Ordered by how likely each is to hurt.

**1. Reference data is two synthesised adult voices.** No children, and
children's formants sit several hundred Hz above adults'. `/l/`–`/w/` is
unreliable (12 of 36 `/w/` tokens read as `/l/`); `/θ/`–`/f/` is genuinely
hard and the stage reports lower confidence there, which is correct behaviour
but not a solution. In-sample identification is 426/504 (84.5%), precision
88.4% at the naming floor. Every figure is in-sample and optimistic by
construction. See `api/app/acoustic/reference/README.md`.

**2. An in-sample corpus cannot detect a fault it shares with the reference.**
The onset window was once allowed to run to 130 ms — longer than the sound it
was bounding — so in a word with a long voiced run it reached past the
constriction into the vowel, and because a vowel is flatter than an
approximant the reading was taken from the vowel. A correct /r/ in "rabbit"
came back as an /l/ substitution at similarity 0.038. The corpus scored itself
as correct throughout, because every corpus word is measured the way the
profiles were built. It was found on a held-out recording.

**3. Three practice surfaces coexist.** `/practice/:sound` is the engine
driven by the local learner model; `/attempt/:sound` is the older
single-attempt flow feeding `/results`; `/journey/:sound` is a server-driven
stage progression with its own SQLite store. The journey predates local
persistence and duplicates progression logic that now lives in the browser.
Converging them means keeping the Results presentation — the best
visualisation work in the project — and repointing it at the learner model.

**4. Four phonemes is a thin syllabus.** `/s/ /r/ /l/ /th/`. Expanding the
inventory needs new reference profiles (scripted, feasible) **and** new
landmark detectors for manners the segmenter does not handle — stops and
vowels are not fricatives or approximants. Real work, not a word-list change.

**5. Stress and rhythm are not measured.** Tested before excluding: eight
two-syllable words with unambiguous stress, both reference voices, syllable
nuclei from the voiced energy envelope scored on prominence × duration. Four
of sixteen tokens produced no clean two-nucleus split; ten of sixteen were
labelled correctly overall — on a binary task where a coin gets eight. A
stress percentage built on that would be a guess wearing a number, so there
is none.

**6. Local-only persistence has real costs.** Clearing site data loses
everything, and progress does not follow a learner to another device or
browser. That is the deliberate trade for working immediately with no account
and no personal data; `exportAll()` lets a learner take a copy.

**7. `/games` is unconnected** to the analysis, and 10 advisory lint warnings
remain (all pre-existing, none errors).

---

## Appendix — where to read more

| Topic | Where |
|---|---|
| Acoustic analysis: features, scoring maths, accuracy | [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) |
| Reference-data limits, measured | `api/app/acoustic/reference/README.md` |
| Learner model rules and thresholds | `web/src/db/policy.ts` |
| Privacy and safety guarantees | `api/app/safety.py`, `web/src/lib/safety.ts` |
| Repository state and verification | [PHONOPLAY_STATUS.md](PHONOPLAY_STATUS.md) |
| Measured submission readiness, with reproduction commands | [FINAL_AUDIT.md](FINAL_AUDIT.md) |
