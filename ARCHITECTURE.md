# PhonoPlay — Architecture

**"Your pronunciation writes your syllabus."**

A personalized pronunciation-learning platform. A learner records themselves,
the audio is measured acoustically, and that measurement — not a language
model's opinion — decides what they practise next.

PhonoPlay is an educational pronunciation practice system. It is **not** a
medical diagnostic tool and not a replacement for a speech-language
professional.

> The detailed record of what is already built — measured accuracy figures,
> feature definitions, scoring maths, safety guarantees — lives in
> [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) §12–17. This document is the
> plan; that one is the evidence.

---

## Contents

1. [Current architecture](#1-current-architecture)
2. [Proposed architecture](#2-proposed-architecture)
3. [Data flow](#3-data-flow)
4. [API design](#4-api-design)
5. [Database design](#5-database-design)
6. [AI pipeline](#6-ai-pipeline)
7. [Audio pipeline](#7-audio-pipeline)
8. [Deployment architecture](#8-deployment-architecture)
9. [Risks](#9-risks)
10. [Implementation phases](#10-implementation-phases)

---

## 1. Current architecture

Findings from reading the source, not from the previous documentation.
588 backend tests pass; the app is live.

### 1.1 Stack

| Layer | Technology |
|---|---|
| Frontend | React 19.2, TypeScript 6.0, Vite 8.2, Tailwind 4.3, react-router 7.18 |
| Backend | FastAPI, Python 3.12, Pydantic v2, uvicorn |
| Analysis | numpy, scipy, librosa, praat-parselmouth, soundfile |
| Audio | ffmpeg / ffprobe (external binaries) |
| Database | **SQLite** via stdlib `sqlite3` |
| AI | Groq — Whisper for speech-to-text, `openai/gpt-oss-120b` for text |
| Lint / test | oxlint, pytest |

**No auth library. No ORM. No state manager** beyond two React contexts.

### 1.2 Frontend

Eight routes: `/`, `/sounds`, `/practice/:sound`, `/journey/:sound`,
`/results`, `/progress`, `/games`, `*`.

State is one 524-line `SessionProvider` (`state/session.tsx`) built on
`useReducer`, plus a second context. 24 components, all hand-written; no
component library.

`lib/` holds `api.ts` (the older flow), `journey.ts` (the newer one),
`recorder.ts` (audio capture), `safety.ts` (disclosure copy),
`fixtures.ts` (offline fallback), `learnerState.ts` (a local heuristic used
only by the Progress page).

### 1.3 Backend

```
app/
  acoustic/    stage 2 — the pronunciation measurement (13 modules)
  stt/         stage 1 — speech-to-text behind a provider interface
  journey/     stages, advancement policy, SQLite store, material generation
  llm/         legacy exercise generation
  audio/       ffmpeg ingest and normalisation
  routers/     analyze, pronunciation, attempts, exercises, catalog,
               progress, journey, health
  data/        hand-written prompt bank
```

### 1.4 API routes (from the live OpenAPI schema)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/analyze` | Stage 1: transcription |
| POST | `/api/pronunciation` | Stage 2: acoustic analysis |
| POST | `/api/attempts` | Combined record — **in-memory only** |
| POST | `/api/exercises` | Legacy generator — **broken, see 1.9** |
| GET | `/api/sounds`, `/api/prompts`, `/api/prompts/{id}` | Catalogue |
| GET | `/api/sessions/{id}/progress` | **In-memory only** |
| GET | `/api/journey/languages`, `/api/journey/stages` | Static definitions |
| GET/PUT | `/api/journey/{learner}/profile` | First-language choice |
| GET | `/api/journey/{learner}`, `/api/journey/{learner}/{sound}` | Progress |
| POST | `/api/journey/{learner}/{sound}/attempt` | Assess and record |
| POST | `/api/journey/{learner}/{sound}/material` | Generate an exercise |
| GET | `/api/health`, `/api/safety` | Readiness, disclosures |

### 1.5 Database

SQLite, three tables:

```sql
learners (learner_id PK, native_language, updated_at)
journeys (learner_id, sound, stage, started_at, updated_at, PK(learner_id, sound))
attempts (id PK, learner_id, sound, stage, outcome, similarity, confidence,
          estimated_match, feedback_code, prompt_text, decision, created_at)
```

Deliberately **no column can hold audio or a transcript**; a test asserts the
exact column set.

### 1.6 Authentication

**None exists.** Identity is an opaque UUID the browser generates and keeps in
`localStorage` under `phonoplay.learner`. It is never asked for, links to
nothing, and is not verified server-side — any client can pass any id and read
that learner's progress. The only `Authorization` headers in the codebase are
*outbound* to Groq.

This is the single largest gap against the target vision.

### 1.7 Audio

Capture: `MediaRecorder`, format negotiated per browser (WebM/Opus, falling
back to MP4/AAC for Safari), 8 s cap, 0.35 s floor, silence check, explicit
review before upload. Server: ffmpeg → 16 kHz mono WAV; one transient temp
file per request, deleted in `finally`.

### 1.8 AI integrations

Two Groq surfaces, correctly kept separate in config:

- `GROQ_MODEL=whisper-large-v3-turbo` — transcription
- `GROQ_CHAT_MODEL=openai/gpt-oss-120b` — text generation

`journey/material.py` uses the chat model correctly and is verified working.
`llm/exercise.py` does not — see below.

### 1.9 Technical debt and broken functionality

**A. `/api/exercises` never reaches the LLM.** `llm/exercise.py:69` sends
`settings.groq_model` — the *speech-to-text* model — to `/chat/completions`.
Verified live:

```
POST /chat/completions  model='whisper-large-v3-turbo'
-> HTTP 400 "does not support chat completions"
```

Every exception is caught and the hand-written bank returned, so it fails
silently. **The "personalized AI challenge" on the primary Practice → Results
flow has never been AI-generated.** The Journey flow is unaffected.

**B. Two parallel systems.** The project contains two complete learner flows
that do not share state:

| | Practice → Results | Journey |
|---|---|---|
| Persistence | module-level dicts | SQLite |
| Survives restart | no | yes |
| Exercises | `llm/exercise.py` (broken) | `journey/material.py` (works) |
| Progression | none | 7-stage policy |
| Visualisation | rich (dial, timeline, deviation card) | minimal |

Each has what the other lacks.

**C. In-memory state.** `SESSION_ATTEMPTS` and `ATTEMPT_RESULTS` are
module-level dicts. `/api/sessions/{id}/progress` reads from them, so all
progress on that path is lost on restart — which on Render's free plan
happens after 15 minutes idle.

**D. Only four phonemes.** `/s/, /r/, /l/, /th/`, each with a small candidate
set. A "syllabus" over four sounds is thin (see [Risks](#9-risks)).

**E. Minor.** `learnerState.ts` duplicates server-side logic client-side;
`/games` is a self-contained word game unconnected to the analysis;
10 advisory lint warnings.

### 1.10 What is genuinely strong

Worth preserving rather than rewriting:

- The acoustic stage is real measurement, not an LLM asked to rate audio.
  Held-out: `/s/` 36/36 with `/θ/` never accepted as `/s/`; `/r/` 36/36 with
  `/w/` never accepted as `/r/`.
- It **refuses to score** when the recording cannot support one — silence,
  noise, clipping all return no number at all.
- The two stages are architecturally separated and tested to stay that way.
- Safety and privacy guarantees are asserted by tests, not just documented.

---

## 2. Proposed architecture

The vision adds accounts, a baseline assessment, a learner model, and an
adaptive syllabus. The measurement engine already exists and does not change.

```
┌─────────────────────────────────────────────────────────────┐
│  React SPA (Vercel)                                         │
│  onboarding · auth · dashboard · assessment · practice      │
│  results · syllabus · progress · Sound Lab                  │
└───────────────┬──────────────────────────┬──────────────────┘
                │ supabase-js (auth)       │ fetch + JWT
                ▼                          ▼
┌───────────────────────────┐  ┌───────────────────────────────┐
│  Supabase                 │  │  FastAPI (Render, Docker)     │
│  · Auth (JWT)             │◄─┤  · verifies JWT               │
│  · Postgres + RLS         │  │  · acoustic analysis (local)  │
│                           │  │  · learner model update       │
└───────────────────────────┘  │  · syllabus adaptation        │
                               └───────┬───────────────────────┘
                                       │
                                       ▼  Groq: Whisper + chat
```

### 2.1 Why Supabase

The target needs authentication *and* a `profiles` table *and* a real
database. Supabase supplies all three in one service, with a JS client the
frontend uses directly for sign-up and sign-in. The backend verifies the JWT
and uses the same Postgres for everything else.

The alternative — hand-rolled JWT auth plus a separately hosted Postgres — is
two more things to build and operate for no benefit on a short deadline.

### 2.2 What changes, what does not

| Component | Action |
|---|---|
| `app/acoustic/` | **Unchanged.** The measurement engine is the asset. |
| `app/stt/` | Unchanged. |
| `app/audio/` | Unchanged. |
| `app/journey/store.py` | Replace SQLite with Postgres; keep the interface |
| `app/journey/policy.py` | Generalise: per-item mastery, not a 7-stage ladder |
| `app/journey/material.py` | Reuse for exercise generation |
| `app/llm/exercise.py` | **Delete** — broken and superseded |
| `routers/attempts.py`, `progress.py` | **Delete** — in-memory, superseded |
| **New** `app/learner/` | Phoneme profile: accumulate evidence, compute mastery |
| **New** `app/syllabus/` | Generate and adapt the syllabus |
| **New** `app/auth.py` | Verify Supabase JWT, resolve `user_id` |

### 2.3 The learner model

This is the heart of the positioning, and the piece that does not exist today.

A `phoneme_profile` row per `(user, phoneme)` accumulates evidence from every
acoustic measurement:

```
attempts_total, attempts_assessed
mean_similarity, recent_similarity   (exponentially weighted)
confusion counts                     {"th": 7, "sh": 2}  what it came out as
mastery        0-1, derived
status         untested | emerging | developing | secure
```

**Mastery is computed from measurements only.** No language model contributes
to it, and there is no path by which generated text can reach it. That is the
same separation the current codebase already enforces between the two stages,
extended one level up.

---

## 3. Data flow

### 3.1 Onboarding → first syllabus

```
sign up (Supabase)
  → profiles row created
  → pick native + target language
  → 3-question self-assessment          (goal, confidence, experience)
  → baseline: ~8 prompts covering /s/ /r/ /l/ /th/
      each → POST /api/practice/attempt → acoustic analysis
      each → phoneme_profiles updated
  → POST /api/syllabus/generate
      LLM receives the phoneme profile SUMMARY (not audio, not scores it invented)
      LLM returns ordered syllabus_items
      code validates every item before it is stored
  → dashboard
```

### 3.2 The practice loop

```
learner opens the next syllabus_item
  → POST /api/practice/session          (starts practice_sessions row)
  → record → review → upload
  → POST /api/practice/attempt
       ├─ ffmpeg normalise
       ├─ acoustic analysis        ← the evidence
       ├─ transcription (parallel) ← context only, never scoring
       ├─ write practice_attempts
       ├─ update phoneme_profiles  ← the learner model
       └─ re-evaluate the syllabus item (mastered? repeat? step back?)
  → results screen: score, evidence, what changed
  → if the item's mastery threshold is met → item complete
  → if several items shift → POST /api/syllabus/adapt
```

### 3.3 The one-way rule

```
audio ──► acoustic analysis ──► phoneme_profile ──► syllabus
                                       │
                                       ▼
                                      LLM  ──► exercise text
                                       │
                                       ✗ never flows back into a score
```

The language model reads the learner model and writes content. It never
writes a measurement. Enforced today by a response schema that forbids
unexpected fields and rejects numeric ones; the same guard extends to
syllabus generation.

---

## 4. API design

Everything under `/api`. All learner routes require
`Authorization: Bearer <supabase-jwt>`; `user_id` comes from the token, never
from the path — which closes the current hole where any client can read any
learner's data by guessing an id.

### Keep unchanged

```
POST /api/analyze              stage 1, transcription
POST /api/pronunciation        stage 2, acoustic measurement
GET  /api/health  /api/safety
```

### New

```
GET   /api/me                          profile + phoneme summary + active syllabus
PATCH /api/me                          languages, self-assessment

GET   /api/assessment/baseline         the fixed baseline prompt set
POST  /api/assessment/complete         finalise baseline, seed profiles

GET   /api/syllabus                    active syllabus + items
POST  /api/syllabus/generate           create from the phoneme profile
POST  /api/syllabus/adapt              re-order / insert / retire items

POST  /api/practice/session            open a session
POST  /api/practice/attempt            the main loop — analyse, record, update
POST  /api/practice/session/{id}/end   close it

GET   /api/progress                    mastery over time, per phoneme
GET   /api/phonemes                    inventory + this learner's status
```

### Retire

```
POST /api/attempts                  in-memory
POST /api/exercises                 broken
GET  /api/sessions/{id}/progress    in-memory
GET  /api/journey/*                 folded into syllabus + practice
```

**`POST /api/practice/attempt` response** — one object, three separable parts,
so nothing can be mistaken for something else:

```jsonc
{
  "analysis":  { /* PronunciationResponse — the measurement */ },
  "transcription": { /* stage 1, or null; never a score */ },
  "learner":   { "phoneme": "s", "mastery": 0.62, "delta": +0.08,
                 "status": "developing" },
  "syllabus":  { "item_id": "...", "state": "in_progress",
                 "action": "repeat", "reason": "..." }
}
```

---

## 5. Database design

Postgres via Supabase. Row-level security on every table: a learner reads and
writes only their own rows.

```sql
-- Supabase auth.users holds credentials. This is the app-side profile.
profiles (
  id                uuid PK REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name      text,                -- optional, never required
  native_language   text NOT NULL DEFAULT 'en',
  target_language   text NOT NULL DEFAULT 'en',
  self_assessment   jsonb,               -- goal, confidence, experience
  baseline_done_at  timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- The learner model. One row per (learner, phoneme). Written ONLY from
-- acoustic measurements.
phoneme_profiles (
  id                 uuid PK,
  user_id            uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  phoneme            text NOT NULL,          -- 's' | 'r' | 'l' | 'th'
  attempts_total     int  NOT NULL DEFAULT 0,
  attempts_assessed  int  NOT NULL DEFAULT 0,   -- refusals excluded
  mean_similarity    real,
  recent_similarity  real,                     -- exponentially weighted
  mean_confidence    real,
  confusions         jsonb NOT NULL DEFAULT '{}',  -- {"th": 7, "sh": 2}
  mastery            real NOT NULL DEFAULT 0,      -- 0-1
  status             text NOT NULL DEFAULT 'untested',
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, phoneme)
);

syllabi (
  id            uuid PK,
  user_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  version       int  NOT NULL DEFAULT 1,
  status        text NOT NULL DEFAULT 'active',   -- active | superseded
  rationale     text,            -- why this syllabus, in plain language
  generated_by  text NOT NULL,   -- 'llm' | 'fallback'  — always disclosed
  created_at    timestamptz NOT NULL DEFAULT now()
);

syllabus_items (
  id            uuid PK,
  syllabus_id   uuid NOT NULL REFERENCES syllabi(id) ON DELETE CASCADE,
  position      int  NOT NULL,
  phoneme       text NOT NULL,
  level         text NOT NULL,   -- isolated|syllable|word|phrase|sentence
  prompt_text   text NOT NULL,   -- what the learner says
  contrast_text text,            -- minimal-pair counterpart, display only
  cue           text,
  state         text NOT NULL DEFAULT 'pending',  -- pending|in_progress|mastered|skipped
  attempts      int  NOT NULL DEFAULT 0,
  best_similarity real,
  UNIQUE (syllabus_id, position)
);

practice_sessions (
  id            uuid PK,
  user_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  syllabus_id   uuid REFERENCES syllabi(id) ON DELETE SET NULL,
  kind          text NOT NULL DEFAULT 'practice',  -- baseline | practice
  started_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz
);

-- One row per recording. NO audio column, NO transcript column - the same
-- guarantee the current schema makes, carried forward and tested.
practice_attempts (
  id               uuid PK,
  session_id       uuid NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  syllabus_item_id uuid REFERENCES syllabus_items(id) ON DELETE SET NULL,
  phoneme          text NOT NULL,
  prompt_text      text NOT NULL,
  assessed         boolean NOT NULL,
  similarity       real,
  confidence       real,
  estimated_match  text,
  feedback_code    text NOT NULL,
  features         jsonb,        -- the measured acoustic features
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON practice_attempts (user_id, phoneme, created_at DESC);
CREATE INDEX ON syllabus_items (syllabus_id, position);
```

**Migration.** The existing SQLite data is disposable — anonymous
`localStorage` ids with no recovery value. No migration is planned; the
tables are created fresh.

Storing `features` per attempt is a small addition that unlocks progress
*in feature space* — "your frication centroid moved from 3.2 kHz to 4.8 kHz" —
which is a learning signal derived entirely from the learner's own data.

---

## 6. AI pipeline

Three AI surfaces, deliberately unequal in authority.

| Surface | Model | Reads | Writes | Can it affect a score? |
|---|---|---|---|---|
| Transcription | Whisper via Groq | audio | words | **No** |
| Syllabus generation | `gpt-oss-120b` | phoneme profile summary | ordered items | **No** |
| Exercise generation | `gpt-oss-120b` | phoneme + level | prompt text, cue | **No** |

**The acoustic analysis is not an AI surface.** It is signal processing with a
statistical classifier over reference profiles — deterministic, inspectable,
and the only thing that produces a number.

### Guards, carried forward from the current codebase

1. Response schemas set `extra="forbid"` — a returned `score` field fails
   validation rather than being silently ignored.
2. Every generated field is a string. There is no numeric field to fill.
3. Generated prompt text is **verified in code** before use: the target sound
   must actually begin the first word, checked against spelling. Material that
   does not contain the sound being practised would corrupt the measurement.
4. A deterministic fallback bank covers every phoneme and level. No API key,
   no network, a timeout, or a rejected response all fall back silently. The
   demo never depends on a network call.
5. `generated_by` is stored and shown, so a learner can always see whether an
   exercise came from a model or the bank.

### Syllabus generation prompt shape

```
input:  target phonemes with status and confusion patterns
        native language, target language, self-assessment
        never: audio, never: raw scores to re-interpret
output: ordered items {phoneme, level, prompt_text, contrast_text, cue}
        + a plain-language rationale
validate: phoneme in inventory, level in enum, prompt starts with the sound,
          length caps, no numeric fields
on failure: deterministic syllabus from the phoneme profile, generated_by='fallback'
```

---

## 7. Audio pipeline

**Unchanged.** It works, is tested, and is the piece least worth touching.

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

**Audio is never persisted.** One transient temp file, removed in `finally`;
no database column can hold it. The only transmission off-server is stage 1 to
Groq, and that is disclosed in the UI rather than glossed. Setting
`STT_PROVIDER=fake` removes even that, at the cost of transcription only.

### Stage 2 in one line

`preprocess → frames → quality gate → segment → features → score → feedback`

Every step can decline. A refusal returns `similarity 0.0`, `confidence 0.0`
and an empty feature set — never a small number a UI could render as a low
score. Full detail: [docs/IMPLEMENTATION.md §14](docs/IMPLEMENTATION.md).

---

## 8. Deployment architecture

```
Browser ──► Vercel (static SPA + /api/* rewrite) ──► Render (Docker, FastAPI)
   │                                                        │
   └────────► Supabase (auth + Postgres) ◄──────────────────┘
                                                            └──► Groq
```

| Piece | Host | Why |
|---|---|---|
| Frontend | Vercel | static SPA, 108 kB gzipped, FCP 632 ms measured |
| Backend | Render (Docker) | needs ffmpeg, 478 MB of scientific Python, a writable disk |
| Auth + DB | Supabase | auth and Postgres in one, with RLS |
| AI | Groq | Whisper + chat |

**Vercel cannot host the backend** — 478 MB of dependencies against a 250 MB
function limit, plus ffmpeg as a real binary. Measured, not assumed.

The frontend reaches the API through a **Vercel rewrite**
(`/api/:path*` → Render), which is a server-to-server hop: no browser CORS, and
preview deployments work without allow-listing each generated origin.

Currently live: `phonoplay-sound-lab.vercel.app` → `phonoplay-api.onrender.com`.

### Environment variables

Existing (26, all documented in `api/.env.example`) plus:

```
SUPABASE_URL              backend: JWT verification + Postgres
SUPABASE_ANON_KEY         frontend: sign-up / sign-in
SUPABASE_SERVICE_KEY      backend only, never sent to the browser
SUPABASE_JWT_SECRET       backend: verify tokens
DATABASE_URL              Postgres connection
VITE_SUPABASE_URL         frontend
VITE_SUPABASE_ANON_KEY    frontend
```

---

## 9. Risks

Ordered by how likely they are to hurt.

**1. Scope against the deadline.** The vision is roughly twice the current
system: auth, onboarding, a learner model, syllabus generation and adaptation,
plus a database migration. The measurement engine — the hard part — is done,
but everything around it is new. *Mitigation: the phasing in §10, with a
working demo at the end of every phase.*

**2. Four phonemes is a thin syllabus.** "Your pronunciation writes your
syllabus" implies enough material to personalise over. Four sounds × five
levels is 20 cells. Expanding the inventory means new reference profiles
(scripted, feasible) **and** new landmark detectors for manners the segmenter
does not handle — stops and vowels are not fricatives or approximants. That is
real work, not a word-list change. *Mitigation: ship four sounds deeply and
say so; treat inventory expansion as post-hackathon.*

**3. Auth is a new failure surface.** Sign-up, sessions, token refresh, RLS
policies, and the "logged out mid-recording" case. *Mitigation: Supabase
handles the hard parts; keep the profile minimal; allow an anonymous trial
path so a broken sign-up cannot block a demo.*

**4. Reference data limits accuracy.** Two synthesised adult voices, no
children. `/l/`–`/w/` unreliable, `/θ/`–`/f/` hard. A syllabus built on a
shaky measurement inherits the shakiness. *Mitigation: mastery requires
several assessed attempts, not one; refusals are excluded; the limits stay
documented in the UI.*

**5. Render free tier.** Spins down after 15 minutes with a ~50 s cold start,
and has no persistent disk. Postgres moves off the disk, which removes half
the problem. *Mitigation: warm before demoing, or upgrade to `starter`.*

**6. Two flows must converge.** Merging Practice/Results and Journey is
refactoring under time pressure, and Results holds the best visualisation
work. *Mitigation: keep the Results presentation, repoint it at the new data
model, delete the in-memory path.*

**7. Syllabus feels arbitrary.** If a learner cannot see why an item was
chosen, the positioning collapses. *Mitigation: every item stores a rationale
tied to a measurement, and the UI shows it.*

---

## 10. Implementation phases

Each phase ends with something demonstrable. If the deadline arrives early,
whatever is finished still works.

### Phase 1 — Foundation
- Supabase project; `profiles` + RLS
- Sign up / sign in / sign out; JWT verification in FastAPI
- `GET/PATCH /api/me`
- **Demo:** an account persists across devices

### Phase 2 — Persistence
- Postgres schema for all six tables
- Repoint the store from SQLite; delete the in-memory routers
- Delete the broken `llm/exercise.py`
- **Demo:** progress survives a restart, tied to an account

### Phase 3 — The learner model *(the core)*
- `app/learner/`: update `phoneme_profiles` from each measurement
- Mastery and status derivation
- `POST /api/practice/attempt` — the single main loop
- **Demo:** recording visibly moves a mastery number

### Phase 4 — Baseline and syllabus
- Baseline assessment (~8 prompts, all four sounds)
- `POST /api/syllabus/generate` with validation and fallback
- Onboarding: languages → self-assessment → baseline → syllabus
- **Demo:** the full "your pronunciation writes your syllabus" story

### Phase 5 — Adaptation
- Item state transitions from measured mastery
- `POST /api/syllabus/adapt`; rationale shown in the UI
- **Demo:** the syllabus visibly changes after practice

### Phase 6 — Surface
- Dashboard, syllabus view, progress over time
- Sound Lab: the existing evidence (per-feature z-scores, located segment,
  candidate posteriors) made visible — it is already returned and never shown
- **Demo:** the full product

### Cut first, if needed
`/games`; multilingual beyond English + Bangla; feature-space progress
visualisation; inventory expansion. None is load-bearing for the pitch.

---

## Appendix — where to read more

| Topic | Where |
|---|---|
| Acoustic analysis: features, scoring maths, accuracy | [docs/IMPLEMENTATION.md §14](docs/IMPLEMENTATION.md) |
| Adaptive journey: stages, policy, persistence | [docs/IMPLEMENTATION.md §15](docs/IMPLEMENTATION.md) |
| Multilingual and the Bangla bridge | [docs/IMPLEMENTATION.md §16](docs/IMPLEMENTATION.md) |
| Privacy and safety guarantees | [docs/IMPLEMENTATION.md §17](docs/IMPLEMENTATION.md) |
| Reference-data limits, measured | `api/app/acoustic/reference/README.md` |
| Current deployment and recovery | [FINAL_AUDIT.md](FINAL_AUDIT.md) |
