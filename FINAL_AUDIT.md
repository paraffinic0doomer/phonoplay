# PhonoPlay — Final Audit

Submission readiness. Every number below was measured on this machine on
2026-08-24, not estimated. Commands to reproduce each are given.

**Gate status**

| Check | Result |
|---|---|
| Backend tests | **584 passed**, 3 skipped (live Groq, opt-in) |
| TypeScript | **clean** |
| Lint (oxlint) | **0 errors**, 10 style warnings |
| Production build | **clean** — 108 kB JS gzipped, 8 kB CSS |
| Browser suites (7) | **all green** |

---

## 1. Working features

### The pipeline

| Stage | Endpoint | Status |
|---|---|---|
| Browser capture | — | MediaRecorder, format negotiated per browser, 8 s cap, review before upload |
| Audio ingest | — | ffmpeg → 16 kHz mono WAV, transient temp file only |
| **Stage 1 — transcription** | `POST /api/analyze` | Groq Whisper, word timings, ~300 ms |
| **Stage 2 — acoustic analysis** | `POST /api/pronunciation` | Local DSP, ~40 ms, no network |
| Combined attempt record | `POST /api/attempts` | Presentation layer over stage 2 |
| Sound Journey | `POST /api/journey/*` | 7 stages, 5 bands, SQLite persistence |
| Practice material | `POST /api/journey/{l}/{s}/material` | Groq chat + deterministic bank |
| Multilingual | `GET/PUT /api/journey/{l}/profile` | English + Bangla first languages |
| Safety disclosures | `GET /api/safety` | Canonical strings, single source |

### Measured behaviour

Held-out minimal pairs (words absent from the reference corpus):

| Audio | Target | Result |
|---|---|---|
| "sank" | /s/ | **s**, similarity 0.93 |
| "thank" | /s/ | **th** — similarity 0.01 |
| "thank" | /th/ | **th**, similarity 0.96 |
| "rag" | /r/ | **r**, similarity 0.85 |
| "wag" | /r/ | not /r/ — similarity 0.04 |
| silence, noise, clipping, 50 ms | any | refused, **no score** |

### Front end

Six screens plus the journey. Reduced motion honoured (verified: zero
elements animate under `prefers-reduced-motion: reduce`). One `<h1>` per
route. Skip link is the first tab stop. Every focusable element shows a focus
ring. No horizontal overflow at 375 / 390 / 768 / 1280 / 1920 px. Every touch
target ≥ 44 px at 375 px.

---

## 2. Known limitations

The full list is in [README.md](README.md#limitations). The ones that matter
for a demo:

**Reference data is 288 tokens of synthesised speech from two adult voices.**
Everything below follows from that.

- **No children in the reference set.** PhonoPlay is designed for children and
  is least reliable for them.
- **/l/ vs /w/ is unreliable** — 15 of 36 /w/ tokens read as /l/.
- **/θ/ vs /f/ is genuinely hard** — 11 of 36 /θ/ tokens read as /f/.
  Confidence drops accordingly (0.72 vs 0.98 for /s/), which is correct
  behaviour, not a fix.
- Accuracy figures are **in-sample**; held-out behaviour is the table above.

**No forced aligner.** The target sound is located by landmark detection, so
only word-initial sounds are practised, and at phrase/sentence stages only the
first occurrence is measured.

**16 kHz** — everything above 8 kHz is invisible, including the top of real
/s/ energy.

**Two languages.** Bangla is a first language only; there is no Bangla
acoustic reference data.

**Browser support.** Chrome, Edge and Firefox are exercised. Safari should
work — `pickFormat()` negotiates `audio/mp4` — but was **not tested here**;
Safari also needs 14.1+ for MediaRecorder. Unprefixed `AudioContext` means
Safari < 14.1 will not record at all.

**Lint:** 10 `react(set-state-in-effect)` style warnings remain. They are
advisory, consistent across the codebase, and none is a correctness problem.

---

## 3. Required environment variables

All server-side. **No key ever reaches the browser** — a test asserts nothing
leaks into an error response. `api/.env` and `groq.txt` are gitignored.

### Required for the full demo

| Variable | Purpose |
|---|---|
| `GROQ_API_KEY` | Speech-to-text **and** practice-material generation |

### Worth setting

| Variable | Default | Note |
|---|---|---|
| `GROQ_MODEL` | `whisper-large-v3-turbo` | speech-to-text |
| `GROQ_CHAT_MODEL` | `openai/gpt-oss-120b` | **a different model** — verify against `GET /openai/v1/models` for your account |
| `STT_PROVIDER` | `groq` | set to `fake` to keep all audio on your own server |
| `JOURNEY_DB_PATH` | `storage/journey.db` | never holds audio or transcripts |
| `CORS_ORIGINS` | `localhost:5173,4173` | |
| `FFMPEG_BIN` / `FFPROBE_BIN` | `ffmpeg` / `ffprobe` | must be on `PATH` |

The full annotated set — 26 variables, every one verified to map to a real
setting — is in `api/.env.example`.

### Runs without any key

The acoustic measurement, the journey, progress, and the practice bank all
work with no API key at all. Only transcription and AI-generated material
need one.

---

## 4. Deployment steps

Requires **Python 3.12+**, **Node 20+**, **ffmpeg on `PATH`**.

```bash
# 1. Backend
cd api
python -m venv .venv
.venv/Scripts/pip install -e ".[dev]"      # POSIX: .venv/bin/pip
cp .env.example .env                        # add GROQ_API_KEY
.venv/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# 2. Frontend
cd web
npm install
npm run build
npx vite preview --port 4173                # or serve dist/ from any static host
```

**Verify before demoing:**

```bash
curl http://127.0.0.1:8000/api/health       # ffmpeg: true, stt configured: true
curl http://127.0.0.1:8000/api/safety       # disclosures load
```

The frontend proxies `/api` to `127.0.0.1:8000` in both `dev` and `preview`
(`vite.config.ts`), so no CORS handling is needed locally. Behind a different
origin, set `CORS_ORIGINS`.

**Startup takes ~10 s.** The lifespan preloads reference profiles and warms
the JIT paths librosa compiles on first use. Wait for
`PhonoPlay API 0.1.0 ready` before the first recording — a cold first request
otherwise costs a second or more.

---

## 5. Demo workflow

The exact flow, verified end to end against the **production build** with real
speech through the microphone:

```
Landing  →  Start a Sound Lab  →  /s/  →  see the word  →  record
   →  Use this recording  →  real result  →  acoustic visualisation
   →  AI challenge  →  Try Again  →  second attempt  →  Progress
```

Measured on the production build:

| Step | Time |
|---|---|
| Landing first contentful paint | **632 ms** |
| Landing total transfer | **115 kB** in 4 requests |
| Record → result on screen | **693 ms** |
| API calls for the whole flow | 1 sounds, 1 prompts, 1 exercises, 2 attempts, 2 analyze |

Reproduce:

```bash
CHROME_PATH="<chrome>" WAV="api/tests/fixtures/speech_sank.wav" \
  BASE=http://localhost:4173 node demo.mjs
```

### Demo notes

- **Say the word clearly and close to the microphone.** The quality gate
  refuses recordings below 15 dB SNR, by design.
- **"Show improved score" is not guaranteed** — the score reflects the actual
  recording. A deliberately poor first attempt (say "thank" where "sank" is
  asked for) followed by a clean one demonstrates improvement honestly, and
  also demonstrates substitution detection.
- **/s/ and /r/ are the strong targets.** Prefer them over /l/ and /th/, whose
  limitations are documented above.
- The journey (`/journey/s`) is a separate, more impressive flow: it adapts
  across seven stages and remembers where you were.

### Demo mode

**There is no separate demo mode, and none was needed.** The default
experience is the real pipeline throughout.

A fallback does exist for one case only — the analysis service being
unreachable — and it is honest about itself: results are stamped `_fixture`,
a badge appears on the value, and the header shows *"Offline demo data — the
analysis service is unreachable"*.

That banner was fixed during this audit. It previously read *"Fixture
fallback enabled"* on **every** dev page load, including when every request
was being served by the real backend — it announced permission, not use. It
is now driven by whether a fallback value has actually been served, and
clears the moment a live call succeeds.

---

## 6. Potential failure points

Ordered by likelihood on the day.

| # | Failure | Symptom | Blast radius |
|---|---|---|---|
| 1 | **Microphone blocked** | Alert: "The microphone is blocked" | Total — nothing works |
| 2 | **Noisy room** | "We couldn't confidently analyze this recording" | Every attempt refused |
| 3 | **Groq key invalid / rate-limited** | Transcription panel absent; material falls back to bank | Cosmetic — **the score still works** |
| 4 | **Backend not running** | Offline-demo banner; labelled fixture values | Degraded but demoable |
| 5 | **ffmpeg missing** | `503 FFMPEG_MISSING` on every upload | Total — no analysis |
| 6 | **Cold start** | First recording takes 1–2 s longer | One attempt |
| 7 | **Safari** | May fail to record | Untested browser |
| 8 | **`GROQ_CHAT_MODEL` wrong** | Material silently falls back to the bank | Cosmetic |

**Point 3 is the important one.** Transcription and the pronunciation
measurement are independent stages. `transcribe()` swallows every failure and
returns null, so a Groq outage removes the transcript panel and leaves the
score untouched. The demo survives losing the network.

---

## 7. Recovery procedures

### Microphone blocked
Click the padlock in the address bar → Site settings → Microphone → Allow →
reload. Chrome remembers per-origin; grant it before the demo, not during.

### Every attempt refused as too noisy
Move closer to the microphone and speak up. To confirm the pipeline is fine
rather than the room:

```bash
curl -F "audio=@api/tests/fixtures/speech_sank.wav" \
     -F "target_sound=s" http://127.0.0.1:8000/api/pronunciation
```
Expect `estimated_match: "s"`, similarity ≈ 0.93.

### Groq failing
Nothing to do — it degrades on its own. To silence it deliberately, set
`STT_PROVIDER=fake` and restart; the pronunciation measurement is unaffected.
To check the key:

```bash
curl -H "Authorization: Bearer $GROQ_API_KEY" \
     https://api.groq.com/openai/v1/models
```

### Backend down mid-demo
The frontend switches to labelled offline data automatically. Restart:

```bash
cd api && .venv/Scripts/python -m uvicorn app.main:app --port 8000
```
Wait for `PhonoPlay API 0.1.0 ready`. The banner clears on the next successful
call — no page reload needed.

### ffmpeg missing
```bash
ffmpeg -version                 # confirm
curl http://127.0.0.1:8000/api/health   # "audio": {"ffmpeg": false}
```
Install it and restart the backend. There is no fallback: the analysis needs
real transcoding.

### Journey progress looks wrong
It is a single SQLite file. To start clean:

```bash
rm -rf api/storage && restart the backend
```
Nothing is lost that matters — no audio was ever stored. Clearing browser
storage resets the learner id and starts a fresh journey.

### Reference data suspect
```bash
cd api && .venv/Scripts/python scripts/evaluate.py
```
Prints the full confusion matrix. Rebuild from scratch:
```bash
powershell -File scripts/build_reference_corpus.ps1
.venv/Scripts/python scripts/build_reference_profiles.py
```

---

## Changes made in this audit

No new features, as instructed.

| Change | Why |
|---|---|
| Extracted `RecordControl` | The mic level re-rendered the whole journey page 60×/sec. **Dropped frames under 4× CPU throttle: 10% → 2–4%**, p95 frame time 40 ms → 22–30 ms |
| Touch targets ≥ 44 px | Nav links and small buttons were 36 px — fine with a mouse, fiddly with a thumb. Now none below 44 px at 375 px |
| Offline banner is state-driven | It claimed fixtures were active while every request hit the real backend |
| `.env.example` completed | Missing `GROQ_CHAT_MODEL`, `LLM_TIMEOUT_S`, `JOURNEY_DB_PATH`, `GROQ_API_KEYS`, `GROQ_KEYS_FILE`. All 26 keys now verified against `Settings` |

**Considered and rejected:** capping the MediaRecorder bitrate to shrink
uploads. Clips are already ~17 kB, and a lossy re-encode would alter exactly
the high-frequency energy the /s/ measurement depends on. Not worth the risk
for a saving nobody would notice.
