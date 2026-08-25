# PhonoPlay — Repository Status

Audit of the existing implementation, 2026-08-25. Everything below was read
from source or observed on the running application; nothing is inferred from
prior documentation.

**Verification run for this audit**

| Check | Result |
|---|---|
| Backend tests | **588 passed**, 3 skipped |
| TypeScript | clean |
| oxlint | **0 errors**, 10 advisory warnings |
| Production build | 108 kB JS gzipped, 8 kB CSS |
| App boots | `ffmpeg: true`, Groq key configured, ready in ~10 s |
| Browser walkthrough | landing → /s/ → record → analyse → result → retry → progress, **clean** |
| Record → result | **836 ms** |

> **Stale file:** `ARCHITECTURE.md` is modified-but-uncommitted and proposes
> Supabase + Postgres + auth. That contradicts CLAUDE.md. It was left untouched
> and needs rewriting or reverting before it misleads anyone.

---

## 1. Current architecture

```
web/  React 19 · TypeScript 6 · Vite 8 · Tailwind 4 · react-router 7
      3 runtime dependencies. No UI library, no state library.
        │  fetch → /api (vite proxy in dev, Vercel rewrite in prod)
        ▼
api/  FastAPI · Python 3.12 · Pydantic v2
      ├─ acoustic/   stage 2 — pronunciation measurement (13 modules, local)
      ├─ stt/        stage 1 — speech-to-text behind a provider interface
      ├─ journey/    stages · advancement policy · SQLite store · material
      ├─ audio/      ffmpeg ingest → 16 kHz mono WAV
      ├─ llm/        legacy exercise generation (broken — §3)
      └─ routers/    8 routers, 18 routes
        │
        ├──→ Groq Whisper       (transcription — audio leaves the server)
        └──→ Groq gpt-oss-120b  (text generation — text only)
```

**Persistence today** is split three ways, none of it IndexedDB:

| Where | What | Survives restart? |
|---|---|---|
| SQLite (`storage/journey.db`) | journeys, attempts, native language | yes |
| Python module dicts | `SESSION_ATTEMPTS`, `ATTEMPT_RESULTS` | **no** |
| Browser `localStorage` | learner id only | yes |
| Browser `sessionStorage` | session state (no audio) | tab only |

**Styling:** Tailwind 4 with an `@theme` block — 25 design tokens, warm paper
/ deep ink, one accent per target sound. Colour never carries meaning alone;
every sound also carries its IPA glyph and a text label.

**Deployment:** frontend on Vercel (`phonoplay-sound-lab.vercel.app`), backend
on Render via Docker (`phonoplay-api.onrender.com`). `/api/*` is proxied by a
Vercel rewrite, so there is no browser CORS. Vercel cannot host the backend —
478 MB of dependencies against a 250 MB limit, plus ffmpeg as a real binary.

**Environment:** 26 variables, all in `api/.env.example`. Only `GROQ_API_KEY`
is required, and only for transcription and generated content — the
pronunciation measurement works with no key at all.

---

## 2. What already works

### Acoustic pronunciation analysis — the strongest asset

Not an LLM asked to rate audio. Signal processing plus a Gaussian naive Bayes
classifier over reference profiles measured through the same code path that
scores a learner.

Observed live during this audit:

| Audio | Target | Result |
|---|---|---|
| "sank" | /s/ | **s**, similarity 0.9304, confidence 0.9886 |
| "thank" | /s/ | **th**, similarity 0.0086 — never mistaken for /s/ |
| "rag" | /r/ | **r**, similarity 0.8455 |
| silence | /s/ | `NO_SPEECH_DETECTED`, **no score at all** |

Runs locally in ~40 ms. Deterministic — identical numbers on Windows, in a
Linux container, and on Render.

### Everything else that works

- **Audio capture** — MediaRecorder with per-browser format negotiation
  (WebM/Opus, MP4/AAC for Safari), 8 s cap, 0.35 s floor, silence detection,
  explicit review before anything is uploaded.
- **Transcription** — Groq Whisper, ~400 ms, word timings, behind a provider
  interface with a `fake` implementation for offline work.
- **Stage separation** — transcription and acoustic analysis are separate
  endpoints with separate schemas, and tests assert no scoring field can
  appear on the transcription response.
- **Refusal behaviour** — noise, clipping, silence and too-short clips return
  `similarity 0.0`, `confidence 0.0` and an empty feature set. Never a small
  number a UI could render as a low score.
- **Journey progression** — 7 stages, 5 visible bands, advance/retreat/hold/
  hint policy as a pure function, persisted in SQLite.
- **Multilingual** — English + Bangla first languages, with articulatory
  bridges (থ → θ → think → three → through). A first language cannot change a
  measurement; asserted on byte-identical audio.
- **Safety** — the disclaimer, the uncertainty sentence and the analysis-
  failure sentence are fixed strings asserted character-for-character. No
  clinical vocabulary in any learner-facing string.
- **Privacy** — no audio or transcript column exists in the schema; one
  transient temp file per request, deleted in `finally`; no personal
  information collected anywhere. Enforced by tests, not just documented.
- **Accessibility basics** — reduced motion honoured (verified: zero elements
  animate), one `<h1>` per route, skip link first in tab order, focus rings on
  every focusable element, 44 px touch targets, no horizontal overflow from
  375 px to 1920 px.

---

## 3. What is broken

### A. `/api/exercises` has never reached the LLM — **live, confirmed**

`app/llm/exercise.py:69` sends `settings.groq_model` — the *speech-to-text*
model — to `/chat/completions`:

```
HTTP 400  "The model `whisper-large-v3-turbo` does not support chat completions"
```

Every exception is caught and the hand-written bank returned, so it fails
silently. **The "personalized AI challenge" on the main Practice → Results
flow has never been AI-generated.** `journey/material.py` uses
`groq_chat_model` correctly and does work.

### B. In-memory state, lost on restart

`SESSION_ATTEMPTS` and `ATTEMPT_RESULTS` are module-level dicts.
`/api/attempts` writes to them and `/api/sessions/{id}/progress` reads from
them, so all progress on that path disappears on restart — which on Render's
free plan happens after 15 minutes idle.

### C. Not broken, but wrong for the new direction

Server-side SQLite persistence is working code that CLAUDE.md rules out.
Learner state should move to IndexedDB. This is a **direction change, not a
defect** — noted here so it is not mistaken for one.

---

## 4. Partially implemented

| Area | State |
|---|---|
| **Onboarding** | None. `LanguagePicker` is rendered inline on `/journey/:sound`, opened by a "Change" link. No route, no flow, no self-assessment. |
| **Progression** | Works, but as a fixed 7-stage ladder per sound. There is no syllabus and no cross-sound sequencing. |
| **Progress view** | `/progress` renders from session state and a client-side heuristic (`lib/learnerState.ts`) that duplicates server logic. |
| **Games** | `/games` is a self-contained word game, not connected to the analysis. |
| **Rhythm / stress** | Not started. Word timings exist from Whisper but are unused for prosody. |

---

## 5. Technical debt

**Two parallel systems that do not share state.** Each has what the other
lacks:

| | Practice → Results | Journey |
|---|---|---|
| Persistence | module dicts | SQLite |
| Survives restart | no | yes |
| Exercises | `llm/exercise.py` — broken | `material.py` — works |
| Progression | none | 7-stage policy |
| Visualisation | rich — dial, timeline, deviation card | minimal |

Converging them is the single largest cleanup, and the Results screen's
visualisation work is worth keeping.

**Smaller items**

- `lib/learnerState.ts` duplicates progression logic client-side.
- 10 advisory `react(set-state-in-effect)` lint warnings.
- `web/src/lib/api.ts` and `web/src/lib/journey.ts` are two API clients with
  different error handling.
- Rich evidence is computed and returned on every request — per-feature
  z-scores, candidate posteriors, the located segment — and **never shown**.

---

## 6. Existing AI, audio and analysis functionality

### AI

| Surface | Model | Status |
|---|---|---|
| Transcription | `whisper-large-v3-turbo` | works, ~400 ms |
| Practice material (journey) | `openai/gpt-oss-120b` | works, ~1.3 s |
| Exercise (legacy) | wrong model | **broken** |

Guards already in place and worth preserving: response schemas set
`extra="forbid"` so a returned `score` field fails validation; every generated
field is a string; generated words are verified in code to actually start with
the target sound; a deterministic bank covers every sound and stage so the app
never depends on a network call.

### Audio

`MediaRecorder → consent → multipart → ffmpeg → 16 kHz mono WAV → two stages
in parallel → discarded.` Audio leaves the server only for transcription, and
that is disclosed in the UI. `STT_PROVIDER=fake` removes even that.

### Analysis

`preprocess → frames → quality gate → segment → features → score → feedback`,
with four targets (/s/, /r/, /l/, /th/) and documented confusion sets that
**already form the minimal-pair map** any contrast exercise would need:

| Target | Contrasts |
|---|---|
| /s/ | /th/, /sh/, /t/ |
| /th/ | /s/, /f/, /t/ |
| /r/ | /w/, /l/ |
| /l/ | /w/, /r/ |

---

## 7. What can be reused, what should be replaced

### Reuse unchanged

`app/acoustic/` · `app/stt/` · `app/audio/` · `app/journey/material.py` ·
`app/journey/policy.py` · `web/src/lib/recorder.ts` · `web/src/lib/safety.ts` ·
the design tokens · `RecordControl`, `RecordButton`, `AudioClipPlayer`,
`ScoreDial`, `SoundJourney`, `HowItWorks`, `ErrorNotice`.

### Reuse with changes

- `journey/stages.py` — a fixed ladder; needs to become mode-dependent to
  support smaller steps and a minimal-pair level.
- `journey/store.py` — correct shape, wrong home. The interface survives; the
  SQLite backing moves to IndexedDB.
- `Results.tsx` — best visualisation in the app; repoint at the new model.

### Replace or delete

- `app/llm/exercise.py` — broken and superseded.
- `app/routers/attempts.py`, `app/routers/progress.py` — in-memory.
- `web/src/lib/learnerState.ts` — duplicated logic.
- One of the two API clients.

---

## 8. Dependencies

**Frontend: 3 runtime dependencies** — react, react-dom, react-router-dom.
Nine dev. Adding Dexie is the only addition the target scope needs.

**Backend:** fastapi, uvicorn, pydantic, pydantic-settings, python-multipart,
httpx, numpy, scipy, librosa, soundfile, praat-parselmouth. No additions
required.

---

## 9. Missing for the final scope

| Missing | Notes |
|---|---|
| Onboarding flow | route, language selection, self-assessment |
| Baseline assessment | fixed prompt set across all four sounds |
| Learner model | per-phoneme mastery accumulated from measurements |
| Syllabus | generation and adaptation |
| **Accessibility Mode** | mode state, alternate ladder, minimal-pair level |
| IndexedDB / Dexie | replaces server-side persistence |
| Rhythm / stress | Whisper word timings exist but are unused |

---

## 10. Recommended implementation order

Each step leaves the app demonstrable.

**1 — Local persistence (Dexie).** Add the client store; move learner state
off SQLite. Unblocks everything else and satisfies "works immediately without
registration."

**2 — Delete the dead paths.** `llm/exercise.py`, `attempts.py`,
`progress.py`, `learnerState.ts`. Fixes defect A by removing it rather than
repairing it, and ends the two-systems split.

**3 — Learner model.** Per-phoneme mastery from measurements. Pure arithmetic
over data the analysis already returns. *This is the core of "your
pronunciation writes your syllabus" and the highest-value single step.*

**4 — Baseline + syllabus.** Short assessment seeds the model; generate items
from it, with validation and the existing fallback bank.

**5 — Accessibility Mode.** A parameter threaded through stages, policy and
material generation — not a second application. The confusion sets above
already supply the minimal-pair content.

**6 — Adaptation and surface.** Item states from measured mastery; dashboard;
Sound Lab exposing the evidence that is already computed and discarded.

**Cut first if time runs short:** `/games`, rhythm/stress, multilingual beyond
English + Bangla.

---

## 11. Biggest technical risks

**1 — Reference data limits everything downstream.** 288 tokens of synthesised
speech from **two adult voices, no children**. /l/–/w/ is unreliable (15 of 36
/w/ tokens read as /l/); /θ/–/f/ is genuinely hard. A syllabus built on a
shaky measurement inherits the shakiness. *Mitigation: require several
assessed attempts before mastery moves; exclude refusals; keep the limits
visible in the UI.*

**2 — Four sounds is a thin syllabus.** Four sounds across five or six levels
is 20–24 cells. Expanding needs new reference profiles (scripted, feasible)
**and** new landmark detectors — the segmenter handles fricatives and
approximants, not stops or vowels. That is real work, not a word-list change.
*Mitigation: ship four sounds deeply and say so.*

**3 — Word-initial only.** No forced aligner, so the target is located by
landmark detection. Only word-initial sounds are practised, and at phrase and
sentence level only the first occurrence is measured. Directly limits
"phrase-level" and "sentence-level" practice.

**4 — Converging two systems under time pressure.** The refactor touches the
most-demoed screen. *Mitigation: keep the Results presentation intact and
change only what feeds it.*

**5 — Render free tier.** Spins down after 15 minutes with a ~50 s cold start.
Moving state to IndexedDB removes the persistence half of this, not the
latency half. *Mitigation: warm before demoing, or upgrade.*

**6 — Accessibility Mode language.** The safety test forbids clinical
vocabulary but **does not yet catch** *dyslexia*, *dyslexic*, *learning
disability*, *special needs*, or *remediation*. That list must be extended
before any Accessibility Mode copy is written.

---

## Appendix — where to read more

| Topic | Where |
|---|---|
| Acoustic analysis: features, maths, measured accuracy | `docs/IMPLEMENTATION.md` §14 |
| Journey: stages, policy, persistence | `docs/IMPLEMENTATION.md` §15 |
| Multilingual and the Bangla bridge | `docs/IMPLEMENTATION.md` §16 |
| Privacy and safety guarantees | `docs/IMPLEMENTATION.md` §17 |
| Reference-data limits, with numbers | `api/app/acoustic/reference/README.md` |
| Deployment and recovery procedures | `FINAL_AUDIT.md` |
