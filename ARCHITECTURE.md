# PhonoPlay — Architecture

**Status:** frontend built. Backend stage 1 (transcription, Groq Whisper) built.
Stage 2 (acoustic pronunciation analysis) is still a plan — see §13.
**Audience:** the team implementing this over a 7-day hackathon.

PhonoPlay is an **educational pronunciation practice tool**. It gives a learner a prompt
containing a target sound, listens to them say it, estimates how closely the production
matched the target, names the most likely pronunciation pattern, and generates a
personalized practice activity. It is not a diagnostic or clinical instrument, and no part
of this document or the codebase should describe it as one.

---

## 0. Repository findings

| Item | Finding |
|---|---|
| Repo | `phonoplay/` — git initialised, remote `paraffinic0doomer/phonoplay`, branch `main`, **zero commits** |
| Existing framework | **None.** Greenfield — no `package.json`, no `pyproject.toml`, no source files |
| Node / npm | v24.12.0 / 11.6.2 |
| Python | **3.14.2 (default)** and **3.12** (`py -V:3.12`) |
| ffmpeg | 8.1.2 on PATH (audio transcoding available without extra install) |

**Decision: the backend targets Python 3.12, not the default 3.14.** `torch`, `torchaudio`,
`numba`/`librosa`, and `ctranslate2` do not reliably publish 3.14 wheels yet; building them
from source would burn a day of the seven. Pin with `py -3.12`.

---

## 1. Stack decision

| Layer | Choice | Why |
|---|---|---|
| Frontend | **Vite + React + TypeScript + Tailwind** | SPA only. No SSR need — every meaningful operation is a POST to a Python service. Vite's dev server is instant; Next.js would add a routing/server model we never use. |
| Backend | **FastAPI on Python 3.12** | Non-negotiable: the acoustic analysis needs `torch`/`torchaudio`/`librosa`. Async I/O, native multipart upload, Pydantic models shared with the response schema, `/docs` for free. |
| Persistence | **SQLite via SQLModel** | Progress-over-retries is a core product claim, so attempts must persist. One file, zero infra. Swappable to Postgres via one URL if it ever matters. |
| LLM | **Claude `claude-opus-5`** via the `anthropic` Python SDK | Exercise generation only. Never scoring. |
| Audio transport | `MediaRecorder` → WebM/Opus blob → multipart POST → ffmpeg → 16 kHz mono WAV | The browser gives no control over WAV encoding; normalise server-side where it is reproducible. |

**Two processes, one repo.** The frontend never touches a model, and the backend never
renders. They meet at a versioned JSON contract (§4).

### Rejected, and why

- **Web Speech API as phoneme detector** — returns orthographic words from a black box with
  no per-phoneme posteriors, no timings, and no acoustic evidence. It cannot support a
  claim about *how* a sound was produced. Not used anywhere in PhonoPlay.
- **Whisper as the pronunciation scorer** — Whisper's language model actively repairs
  mispronunciations toward valid English. Say "wabbit" and it may well write "rabbit". It is
  a good *linguistic* signal and a poor *acoustic* one. It gets exactly one job: transcription.
- **Montreal Forced Aligner / Kaldi** — correct tooling, wrong week. Heavy install, separate
  binary, brittle on Windows. `torchaudio.functional.forced_align` gives us CTC forced
  alignment in-process.
- **A whole-utterance "pronunciation score" model** — would produce one opaque number. The
  product needs a *named deviation on a specific phoneme*, which requires frame-level
  posteriors regardless.

---

## 2. Project structure

```
phonoplay/
├── ARCHITECTURE.md
├── README.md
├── .env.example
├── .gitignore
│
├── web/                                 # Vite 8 + React 19 + TS + Tailwind 4  [BUILT]
│   ├── package.json  vite.config.ts  tsconfig*.json  index.html  .env.example
│   └── src/
│       ├── main.tsx  App.tsx            # BrowserRouter + routes
│       ├── index.css                    # design tokens (@theme), base, keyframes
│       ├── pages/
│       │   ├── Landing.tsx              # hero, how it works, target sounds
│       │   ├── SoundSelect.tsx          # the four sounds + articulation reference
│       │   ├── Practice.tsx             # prompt, mic capture, "Analyzing your sound…"
│       │   ├── Results.tsx              # score, comparison, deviation, challenge
│       │   ├── Progress.tsx             # attempt history + improvement graph
│       │   └── NotFound.tsx
│       ├── components/
│       │   ├── AppShell.tsx             # header, nav, skip link, positioning footer
│       │   ├── Button.tsx  Stepper.tsx  DifficultyDots.tsx  ErrorNotice.tsx
│       │   ├── SoundCard.tsx            # one target sound on the selection screen
│       │   ├── MouthDiagram.tsx         # per-sound tongue position, SVG
│       │   ├── WaveField.tsx            # canvas wave + Waveform (real decoded peaks)
│       │   ├── RecordButton.tsx         # mic button, live level ring, 5s cap
│       │   ├── ScoreDial.tsx            # dial + ConfidenceMeter + useCountUp
│       │   ├── SoundCompare.tsx         # target vs measured + posterior bars
│       │   ├── PhonemeTimeline.tsx      # per-phoneme GOP bars  <- key viz
│       │   ├── DeviationCard.tsx        # pattern + confidence + evidence list
│       │   ├── ExercisePanel.tsx        # AI-generated activity, "Try Again"
│       │   ├── ImprovementGraph.tsx     # attempt-over-attempt improvement (SVG)
│       │   └── FixtureBadge.tsx         # discloses fixture-backed numbers
│       ├── lib/
│       │   ├── recorder.ts              # MediaRecorder + analyser + decodeWaveform
│       │   ├── api.ts                   # typed client for every endpoint in §4
│       │   └── fixtures.ts              # TEMPORARY — delete when the API lands
│       ├── data/sounds.ts               # per-sound presentation catalogue
│       ├── state/session.tsx            # useReducer + context (no state library)
│       ├── types/api.ts                 # hand-mirrored from api/app/schemas.py
│       └── env.d.ts
│
└── api/                                 # FastAPI + Python 3.12
    ├── pyproject.toml
    ├── app/
    │   ├── main.py                      # app, CORS, lifespan model preload
    │   ├── config.py                    # pydantic-settings
    │   ├── schemas.py                   # * single source of truth for the API contract
    │   ├── db.py  models.py             # SQLModel engine + tables
    │   ├── routers/
    │   │   └── health.py  sounds.py  prompts.py  attempts.py  exercises.py  progress.py
    │   ├── audio/
    │   │   ├── ingest.py                # ffmpeg -> 16 kHz mono float32
    │   │   └── quality.py               # duration / clipping / SNR / silence gate
    │   ├── asr/whisper.py               # faster-whisper wrapper
    │   ├── phonetics/
    │   │   ├── lexicon.py               # loads data/prompts.json
    │   │   ├── confusions.py            # per-target confusion sets
    │   │   └── g2p.py                   # BUILD-TIME ONLY (see §6.3)
    │   ├── acoustic/
    │   │   ├── posteriors.py            # wav2vec2 CTC -> frame log-probs
    │   │   ├── align.py                 # torchaudio forced_align -> phone segments
    │   │   ├── gop.py                   # GOP + substitution detection
    │   │   └── features.py              # F3, spectral centroid, sibilant ratio, duration
    │   ├── scoring/score.py             # fuse signals -> scores + deviation + confidence
    │   ├── llm/
    │   │   ├── client.py  exercise.py   # Claude, schema-validated
    │   │   └── fallback.py              # deterministic exercise bank
    │   └── data/prompts.json            # curated prompt bank w/ verified phoneme strings
    └── scripts/
        ├── build_prompts.py             # g2p + hand-check -> data/prompts.json
        ├── download_models.py           # warm the HF/CT2 cache before demo day
        └── calibrate.py                 # fit tau and thresholds on real recordings
```

### Status

`web/` is built and running. `api/` serves both analysis stages and the Sound
Journey:

| Stage | Endpoint | State |
|---|---|---|
| 1 — transcription | `POST /api/analyze` | built, Groq Whisper (§13) |
| 2 — acoustic analysis | `POST /api/pronunciation` | built, DSP (§14) |
| Sound Journey | `POST /api/journey/*` | built (§15) |
| Combined attempt record | `POST /api/attempts` | built, presentation over §14 |
| Multilingual (en, bn) | `GET/PUT /api/journey/{learner}/profile` | built (§16) |
| Safety & privacy | `GET /api/safety` | built (§17) |

§3 below is the **original plan** for stage 2, using wav2vec2 posteriors and
forced alignment. What shipped is §14, a signal-processing model — smaller,
CPU-only, and fully inspectable. §3 remains the documented upgrade path, and
the two sections should be read together: §3 says where this is going, §14
says what it does today and what that costs.

**Build order:** `schemas.py` first. It is the contract, and `web/src/types/api.ts` is
already written against it; the two must agree.

---

## 3. The pronunciation-analysis pipeline

Two independent signals, fused at the end. Neither one alone decides anything.

```
                          +- ASR / linguistic ---------------------------+
  WebM/Opus               |  faster-whisper small.en                     |
      |                   |  -> transcript, word match, edit distance    |
      v                   +----------------------------------------------+
  (1)ingest -> (2)quality |                                              | -> (7)fuse -> (8)exercise
   16k mono      gate     |                                              |
                          +- Acoustic -----------------------------------+
                             (3) wav2vec2 CTC phoneme posteriors
                             (4) forced alignment to EXPECTED phones
                             (5) GOP + substitution detection
                             (6) interpretable features (F3, centroid, duration)
```

### (0) Browser capture — `web/src/lib/recorder.ts`  [BUILT]

Before anything reaches the backend, the client captures and measures. See §12 for the
full pipeline; the contract that matters here is that the upload is multipart, the audio
is **whatever container the browser produced** (never assume WAV), and five
`client_*` fields carry the original capture metadata alongside it.

### (1) Ingest — `audio/ingest.py`

`ffmpeg -i in.<ext> -ac 1 -ar 16000 -f wav -` → float32 numpy. The input extension varies
by browser, so probe rather than assume. Trim leading/trailing silence (energy threshold),
peak-normalise. Reject > 10 s.

**Preserve, do not discard.** Echo the `client_*` fields back in
`audio_quality.source` so the pre-transcode sample rate, channel count, duration, and MIME
type survive normalisation. Re-derive them server-side too and prefer the server's own
measurement when they disagree — the client's numbers are a claim, not proof.

### (2) Quality gate — `audio/quality.py`

Compute duration, peak, clipping fraction, and SNR (speech frames vs. noise floor).
If duration < 0.3 s, or SNR < ~10 dB, or clipping > 1%, **return `audio_quality.ok = false`
and stop**. The UI asks for a re-record.

> This gate is a product requirement, not a nicety. Scoring noise produces a number that
> looks real and means nothing — the exact failure mode the "no fake AI" principle forbids.

### (3) Phoneme posteriors — `acoustic/posteriors.py`

A **wav2vec2 CTC model with a phoneme vocabulary** — primary candidate
`facebook/wav2vec2-lv-60-espeak-cv-ft` (eSpeak IPA output), fallback `charsiu/en_w2v2_fc_10ms`.
Output: `log_probs [T, V]` at ~20 ms/frame over the phoneme vocabulary. **This is the
acoustic engine.** It is a separate model from Whisper, with a separate job.

*Day-1 spike:* confirm the vocabulary, frame rate, and that `forced_align` accepts its
log-probs. Everything downstream depends on this; find out on day 1, not day 5.

### (4) Forced alignment — `acoustic/align.py`

Take the **expected** phoneme sequence for the prompt (from `prompts.json`, not from the
recording) and run `torchaudio.functional.forced_align(log_probs, targets, blank=0)`.
Yields `(phoneme, start_frame, end_frame)` per expected phone.

Aligning to the *expected* sequence — not to a free decode — is what makes the next step a
measurement of a specific phoneme rather than a guess about which phoneme it was.

### (5) GOP + substitution — `acoustic/gop.py`

For an expected phone `p` aligned to frames `t ∈ [t0, t1]`, `N = t1 - t0`:

```
GOP(p) = (1/N) * SUM_t log P(p | x_t)  -  (1/N) * SUM_t max_q log P(q | x_t)
```

Goodness of Pronunciation, the standard posterior-ratio formulation. `GOP <= 0`; it is `0`
only when `p` was the most likely phone on every frame. Bounded normalisation:

```
gop_norm = exp(GOP / tau)        tau ~ 2.0, fitted in scripts/calibrate.py
```

Monotone, in `(0, 1]`, one documented constant — no magic numbers.

**Substitution detection.** Let `A` = modal argmax phoneme over `[t0, t1]`.

| Condition | Result |
|---|---|
| `A == p` and `gop_norm` high | on target |
| `A == p` and `gop_norm` low | `distortion` — right target, imprecise production |
| `A ∈ ConfusionSet(p)` | `substitution`, `p -> A` |
| `A ∉ ConfusionSet(p)` | `unclear` — **we do not invent a label** |

Confusion sets (`phonetics/confusions.py`) are documented English pronunciation patterns:

| Target | Common substitutions |
|---|---|
| `/r/` (ɹ) | `w`, `l`, `ʊ` |
| `/l/` | `w`, `ɹ`, `j` |
| `/s/` | `ʃ`, `θ`, `t`, `z` |
| `/th/` (θ) | `f`, `s`, `t`, `d` |

Constraining to these sets is what keeps the reported deviation linguistically plausible
instead of whatever the softmax happened to rank second.

### (6) Interpretable features — `acoustic/features.py`

Cheap `librosa`/LPC measurements over the aligned target segment. They corroborate the
posteriors and — just as importantly — give the UI something a learner can *see*.

| Target | Feature | Reading |
|---|---|---|
| `/r/` | **F3** (LPC formant) | low F3 is the acoustic signature of English /ɹ/; high F3 with a `w` argmax is strong r→w evidence |
| `/s/` vs `/ʃ/` | spectral centroid, energy ratio above 4 kHz | /s/ frication sits higher than /ʃ/ |
| `/th/` | centroid + total frication energy | weak; /θ/–/f/ is genuinely hard acoustically → we report **lower confidence**, honestly |
| `/l/` | F2, segment duration | lateral vs. glide distinction |

**Speaker normalisation:** absolute formants vary hugely across speakers. Compare F3 in the
target segment against *that speaker's own median F3 across the vowels of the same
utterance*. Free, and it removes most of the speaker dependence.

### (7) Fusion — `scoring/score.py`

```
target_sound_score = 100 * mean(gop_norm over occurrences)
word_accuracy      = 100 * (1 - normalised_edit_distance(transcript, prompt_text))
overall            = 0.7 * target_sound_score + 0.3 * word_accuracy
```

Weights live in `config.py` and are stated in the UI's methodology note. Every number
traces back to the audio.

**Deviation confidence** is a weighted vote over three independent signals — posterior
argmax (0.5), feature rule (0.3), transcript mismatch (0.2). **When signals disagree, the
deviation type is `inconclusive` and the UI says so.** Reporting "we are not sure" is a
supported outcome, not a bug.

### (8) Exercise generation — `llm/exercise.py`

Claude receives the *structured analysis output*, never the audio. Schema-validated via the
Python SDK's Pydantic parse path:

```python
resp = client.messages.parse(
    model="claude-opus-5",
    max_tokens=4096,
    thinking={"type": "adaptive"},
    output_format=GeneratedExercise,   # Pydantic model -> resp.parsed_output
    messages=[{"role": "user", "content": analysis_summary}],
)
```

Input: target phoneme, deviation label + confidence, GOP, feature readings, prior attempts
in the session. Output: a contrastive-pair drill, an articulation cue, and 3–5 next prompts
that isolate the specific deviation (e.g. r→w gives minimal pairs `red/wed`, `ring/wing`).

**`llm/fallback.py` is mandatory, not optional.** A hand-written exercise bank keyed by
`(target, deviation)` covers every API failure, timeout, and missing key. The demo must
never depend on a network call succeeding.

---

## 4. API contracts

Base `/api`. JSON except the audio upload. Pydantic in `schemas.py` is the source of truth;
`web/src/types/api.ts` mirrors it.

| Method | Path | Body → Response |
|---|---|---|
| `GET` | `/health` | → `{status, models:{asr,acoustic}, version}` — reports **model warm state** |
| `GET` | `/sounds` | → `[{id:"r", ipa:"ɹ", label, description}]` |
| `GET` | `/prompts?sound=r&level=word\|sentence&exclude=id1,id2` | → `Prompt` |
| `GET` | `/prompts/{id}` | → `Prompt` — practising a specific challenge word |
| `POST` | `/attempts` | multipart `audio` + `prompt_id`, `session_id`, `exercise_id?` → `AttemptResult` |
| `GET` | `/attempts/{id}` | → `AttemptResult` |
| `POST` | `/exercises` | `{attempt_id}` → `Exercise` |
| `GET` | `/sessions/{id}/progress` | → `{by_sound:{r:[{attempt_n, score, ts}]}, deltas}` |

**Analysis and exercise generation are deliberately separate calls.** Analysis is ~1–2 s;
Claude is ~3–8 s. Splitting them lets the score and timeline paint immediately while the
exercise loads — better UX, and a demo that never looks frozen.

### `AttemptResult` — the central object

```jsonc
{
  "attempt_id": "uuid",
  "prompt": { "id": "r_word_012", "text": "rabbit", "target_sound": "r", "target_ipa": "ɹ" },

  "audio_quality": { "ok": true, "duration_s": 1.24, "snr_db": 22.4,
                     "clipped": false, "warnings": [] },

  "transcript": { "text": "wabbit", "asr_confidence": 0.82,
                  "word_match": false, "normalized_edit_distance": 0.17 },

  "target_analysis": {
    "target_phoneme": "ɹ",
    "occurrences": [{
      "index": 0, "start_s": 0.08, "end_s": 0.19,
      "gop": -1.83, "gop_normalized": 0.40,
      "observed_top": [ {"phoneme":"w","prob":0.61},
                        {"phoneme":"ɹ","prob":0.21},
                        {"phoneme":"l","prob":0.06} ],
      "verdict": "substitution"
    }]
  },

  "phoneme_timeline": [ {"phoneme":"ɹ","start_s":0.08,"end_s":0.19,"gop_normalized":0.40},
                        {"phoneme":"æ","start_s":0.19,"end_s":0.31,"gop_normalized":0.91} ],

  "acoustic_features": { "f3_hz": 2410, "f3_speaker_median_hz": 2680,
                         "spectral_centroid_hz": null, "sibilant_ratio": null,
                         "target_duration_s": 0.11 },

  "deviation": {
    "type": "substitution",              // substitution | distortion | omission | unclear | inconclusive
    "label": "r_to_w", "from": "ɹ", "to": "w",
    "confidence": 0.78,
    "evidence": ["posterior_argmax", "f3_not_lowered", "transcript_mismatch"],
    "explanation": "The /r/ sound was produced closer to /w/."
  },

  "scores": { "overall": 42, "target_sound": 38, "word_accuracy": 55, "confidence": 0.78 },
  "timings_ms": { "ingest": 90, "asr": 610, "acoustic": 420, "total": 1160 }
}
```

`evidence` and `confidence` are contract-level, not decoration: no deviation is ever
reported without naming which signals voted for it.

### `Exercise`

```jsonc
{
  "id": "uuid", "attempt_id": "uuid", "target_sound": "r", "deviation_label": "r_to_w",
  "title": "Tell /r/ and /w/ apart",
  "cue": "Pull the tongue back and keep your lips relaxed — do not round them.",
  "activity_type": "minimal_pairs",
  "items": [ {"text":"red","contrast":"wed","target_ipa":"ɹ","prompt_id":"r_word_002"},
             {"text":"ring","contrast":"wing","target_ipa":"ɹ","prompt_id":"r_word_005"} ],
  "difficulty": 2,
  "source": "llm"                        // "llm" | "fallback"  <- always visible
}
```

### Errors

`{ "error": { "code": "AUDIO_TOO_QUIET", "message": "...", "retryable": true } }`

Codes: `AUDIO_TOO_SHORT`, `AUDIO_TOO_QUIET`, `AUDIO_CLIPPED`, `NO_SPEECH_DETECTED`,
`ALIGNMENT_FAILED`, `MODEL_NOT_READY`, `LLM_UNAVAILABLE`.

---

## 5. Data models (SQLite / SQLModel)

```
Session(id, created_at, target_sound, label)

Prompt          -- static, loaded from data/prompts.json, not a table

Attempt(id, session_id, prompt_id, exercise_id?, created_at,
        audio_path, duration_s, snr_db,
        transcript, normalized_edit_distance,
        score_overall, score_target, score_word, confidence,
        deviation_type, deviation_label, deviation_confidence,
        analysis_json)                  -- full AttemptResult, for replay + calibration

PhonemeScore(id, attempt_id, phoneme, occurrence_index,
             start_s, end_s, gop, gop_normalized, argmax_phoneme, is_target)

Exercise(id, attempt_id, target_sound, deviation_label,
         payload_json, source, created_at)
```

`analysis_json` is deliberate: it makes `scripts/calibrate.py` possible without re-running
inference, and it makes every demo reproducible.

`prompts.json` entry:

```jsonc
{ "id": "r_word_012", "text": "rabbit", "target_sound": "r",
  "phonemes": ["ɹ","æ","b","ɪ","t"],      // hand-verified at build time
  "target_indices": [0], "level": "word", "difficulty": 1 }
```

---

## 6. Implementation notes that decide whether this ships

### 6.1 Preload models at startup

Load Whisper and wav2vec2 in the FastAPI `lifespan`, never per-request. A cold first request
is a 30-second dead demo. `/health` reports warm state; the UI disables Record until warm.

### 6.2 CPU-first

`faster-whisper small.en` int8 + wav2vec2-base on CPU keeps a 2 s clip near ~1.5 s total.
Assume no GPU on the demo machine.

### 6.3 G2P runs at build time, not request time

Prompts are a curated, finite set. `scripts/build_prompts.py` runs `g2p_en` once, a human
checks the output, and the result is committed in `prompts.json`. Request-time G2P adds a
dependency, latency, and a class of silent errors — for zero benefit on a fixed prompt bank.

### 6.4 The scoring rules are visible

A "How scoring works" panel states the GOP formula, the 0.7/0.3 weighting, and the
confidence vote. Explaining the method is both honest and the strongest answer to a judge
who asks whether the number is real.

---

## 7. Environment variables

`.env.example` (committed; `.env` git-ignored):

```bash
# -- Backend ------------------------------------------
ANTHROPIC_API_KEY=sk-ant-...          # exercise generation only
ANTHROPIC_MODEL=claude-opus-5

APP_ENV=development
API_HOST=127.0.0.1
API_PORT=8000
CORS_ORIGINS=http://localhost:5173

DATABASE_URL=sqlite:///./phonoplay.db
AUDIO_STORAGE_DIR=./storage/audio
FFMPEG_BIN=ffmpeg

ASR_MODEL=small.en                    # faster-whisper
ASR_COMPUTE_TYPE=int8
ACOUSTIC_MODEL=facebook/wav2vec2-lv-60-espeak-cv-ft
TORCH_DEVICE=cpu
HF_HOME=./.cache/hf

# scoring constants -- tuned by scripts/calibrate.py, never guessed at runtime
GOP_TAU=2.0
SCORE_WEIGHT_TARGET=0.7
SCORE_WEIGHT_WORD=0.3
MIN_SNR_DB=10.0
MIN_DURATION_S=0.3
MAX_DURATION_S=10.0

# -- Frontend (web/.env) ------------------------------
VITE_API_BASE_URL=http://localhost:8000/api
```

---

## 8. Local development

```bash
# -- Backend (first time) -----------------------------
cd api
py -3.12 -m venv .venv                 # 3.12, NOT the default 3.14
.venv\Scripts\activate                 # PowerShell
pip install -e .
python scripts/download_models.py      # pre-warm the model cache -- do this before demo day
python scripts/build_prompts.py        # regenerate data/prompts.json (rarely needed)

# -- Backend (daily) ----------------------------------
uvicorn app.main:app --reload --port 8000
#   docs      -> http://localhost:8000/docs
#   warm-up   -> curl http://localhost:8000/api/health

# -- Frontend -----------------------------------------
cd web
npm install
npm run dev                            # http://localhost:5173
npm run build
```

**Dependencies — the whole list.** Backend: `fastapi`, `uvicorn[standard]`, `pydantic-settings`,
`sqlmodel`, `python-multipart`, `faster-whisper`, `torch`, `torchaudio`, `transformers`,
`librosa`, `numpy`, `anthropic`. Build-time only: `g2p_en`. Frontend: `react`, `react-dom`,
`vite`, `typescript`, `tailwindcss`, `react-router-dom`. Nothing else without a reason —
no state library, no UI kit, no charting library (the progress graph is hand-drawn SVG),
no ORM beyond SQLModel.

---

## 9. Seven-day sequence

| Day | Goal | Done when |
|---|---|---|
| 1 | **Spike the acoustic model.** Load wav2vec2, inspect vocab, run `forced_align` on one WAV, print per-phone GOP. Scaffold both apps. | A real GOP number prints for a real recording |
| 2 | `schemas.py` frozen. Ingest + quality gate + Whisper. `POST /attempts` returns a real `AttemptResult`. | curl returns JSON with real scores |
| 3 | Frontend loop: pick sound → prompt → record → POST → ScoreDial + PhonemeTimeline. | End-to-end in the browser |
| 4 | Deviation detection: confusion sets, feature rules, confidence vote. `DeviationCard`. | r→w correctly identified on a deliberate mispronunciation |
| 5 | Claude exercise generation + fallback bank. `ExercisePanel`. | Exercise appears; unplug the network and it still appears |
| 6 | `calibrate.py` on ~30 real recordings → fit `tau` and thresholds. Progress chart. Retry loop closes. | Scores track human judgement; improvement is visible across retries |
| 7 | Polish, methodology panel, error states, demo script, rehearsal. | Two clean run-throughs, no cold start |

**Critical path is day 1.** If `facebook/wav2vec2-lv-60-espeak-cv-ft` disappoints, switch to
`charsiu/en_w2v2_fc_10ms` that same day. Everything downstream — GOP, deviation, exercises,
visualisation — assumes frame-level phoneme posteriors exist.

---

## 10. Known limitations (state these; do not paper over them)

- **/θ/ vs /f/ is acoustically weak.** Both are low-energy fricatives with similar spectra.
  We report reduced confidence rather than a confident wrong answer.
- **Formant estimates are speaker-dependent.** Mitigated by within-utterance normalisation,
  not eliminated.
- **The acoustic model is trained mostly on adult speech.** Child and strongly accented
  speech will score lower for reasons unrelated to the target sound.
- **Absolute scores are calibrated heuristics.** The trustworthy signal is *relative
  improvement across attempts by the same speaker on the same prompt* — which is exactly
  what the core loop measures.
- **Not a diagnostic tool.** PhonoPlay gives pronunciation practice feedback. It does not
  assess, diagnose, or treat anything, and no copy in the product should imply otherwise.

---

## 11. Contract notes added during frontend implementation

Two additions the screens turned out to need. Both are in `web/src/types/api.ts`
already and must be mirrored when `schemas.py` is written.

- **`GET /prompts/{id}`** — the results screen offers "practise this exact word",
  which needs prompt lookup by id, not just "give me one for this sound".
- **`ExerciseItem.prompt_id`** — an exercise item the learner can practise must
  point at a real prompt. `null` is allowed and means "not in the bank", in which
  case the UI falls back to a fresh prompt for the same sound rather than
  offering a button that leads nowhere.

Until the service exists, `web/src/lib/fixtures.ts` answers these endpoints with
scripted placeholders. It analyses nothing, every value it returns is stamped
`_fixture: true`, and the UI discloses that on screen. Delete that file when the
backend lands.

---

## 12. Audio capture pipeline (implemented)

The browser half of §3, built in `web/src/lib/recorder.ts` and driven by
`web/src/pages/Practice.tsx`. Everything here is real Web Audio and MediaRecorder;
no part of it is simulated.

```
  detectSupport()        secure context? MediaRecorder? mediaDevices?
        │                  ├─ insecure-context ─▶ MIC_INSECURE_CONTEXT
        │                  └─ unsupported      ─▶ MIC_UNSUPPORTED
        ▼
  getUserMedia()         channelCount 1, echoCancellation on,
        │                autoGainControl OFF (AGC would rescale the very
        │                loudness differences the analysis measures)
        │                OverconstrainedError ─▶ retry once with {audio:true}
        │                NotAllowed ─▶ MIC_DENIED   NotFound ─▶ MIC_NOT_FOUND
        │                NotReadable ─▶ MIC_BUSY
        ▼
  pickFormat()           first supported of: webm/opus, ogg/opus, webm,
        │                mp4/aac, ogg  →  container + file extension
        ▼
  MediaRecorder          + AnalyserNode for the live level ring.
        │                track 'ended' and recorder 'error' both surface as
        │                RECORDING_FAILED rather than hanging.
        │                Hard stop at MAX_CLIP_MS = 8000.
        ▼
  analyseClip()          ONE decodeAudioData pass yields:
        │                  durationS   ← decoded, not wall-clock
        │                  peak / rms  ← for the silence gate
        │                  peaks[72]   ← waveform for the UI
        │                sampleRate and channels come from the DEVICE
        │                (track.getSettings()), because decodeAudioData
        │                resamples to the AudioContext rate.
        ▼
  validateClip()         empty (<1 kB or 0 s) · too-short (<0.35 s)
        │                silent (peak < 0.02) · too-long
        │                ── a clip that fails NEVER reaches the network ──
        ▼
  REVIEW                 the learner plays it back and decides.
        │                ── nothing is transmitted before this ──
        ▼
  POST /api/attempts     multipart: audio + prompt_id + session_id
                         + client_mime_type, client_duration_s,
                           client_sample_rate, client_channels,
                           client_size_bytes
                         AbortController at 45 s ─▶ UPLOAD_TIMEOUT
                         failure keeps the clip so retry re-sends it
```

### Clip length

Target 2–8 s. 8 s is a hard ceiling enforced by auto-stop. There is deliberately **no 2 s
minimum**: single words like "sun" take well under a second, and rejecting them would be
wrong. The 0.35 s floor exists only to catch a click that captured nothing.

### State machine

`idle → loading-prompt → ready → requesting-permission → recording → review →
processing → success`, with `error` reachable from any of them. `review` is the consent
gate: stopping a recording is not on its own permission to send audio anywhere.

### Audio lifetime

Blobs live in memory for the session and nowhere else. They are never written to
sessionStorage — persistence stores scores and prompts only, and drops audio to `null`.
`AudioClipPlayer` is the single component that calls `createObjectURL`, and it revokes on
unmount and on blob change, so URLs cannot accumulate across repeated recordings. The
microphone track is stopped as soon as a clip is captured, so the browser's recording
indicator clears promptly.

### Credentials

The frontend holds none. `ANTHROPIC_API_KEY` is backend-only (§7) and is never read by,
bundled into, or proxied through the client.

---

## 13. Transcription stage (implemented)

Stage 1 of §3, live at `POST /api/analyze`. Stage 2 remains unbuilt; the two
are deliberately separate endpoints, separate models, separate failure modes.

### Provider abstraction

```
app/stt/
  base.py           SpeechToTextProvider (ABC) + Transcription/Segment/Word
  languages.py      "English" -> "en", shared by every provider
  errors.py         SttError taxonomy -> stable frontend error codes
  groq_provider.py  the ONLY module that knows Groq exists
  fake_provider.py  offline provider for tests (STT_PROVIDER=fake)
  __init__.py       build_provider() / get_provider() / set_provider()
```

Application code depends on `SpeechToTextProvider` and receives a normalized
`Transcription`. Two tests enforce this rather than trusting convention:
`test_no_module_outside_stt_imports_groq` and
`test_httpx_is_only_reached_through_the_provider`.

### Pipeline

```
  multipart upload
        │
        ▼
  ingest.normalize()      size gate -> temp file -> ffprobe -> ffmpeg
        │                 out: 16 kHz mono WAV (never assume the browser
        │                 sent WAV; Chrome sends WebM/Opus, Safari MP4/AAC)
        │                 rejects: EMPTY_AUDIO INVALID_AUDIO NO_AUDIO_STREAM
        │                          AUDIO_TOO_LARGE/SHORT/LONG TRANSCODE_FAILED
        ▼
  provider.transcribe()   Groq POST /audio/transcriptions
        │                 verbose_json + timestamp_granularities[]=word,segment
        │                 timeouts 5 s connect / 30 s read
        │                 ONE retry, transient only (429, 5xx, network)
        │                 4xx never retried — a bad key will not fix itself
        ▼
  TranscriptionResponse   transcript, language(+code), duration, segments
                          with word timings, audio + source metadata, timings
```

**Why one retry.** Groq bills a 10-second minimum per request. PhonoPlay clips
are 1–2 seconds, so every retry costs a full 10-second unit for no extra
signal. Retrying hard would multiply spend on exactly the failures least
likely to resolve.

**Temp file, not a pipe.** ffprobe cannot seek a pipe, and without seeking it
reports no duration for several containers including WAV. The upload is
spilled to a temp file for the request and deleted in `finally`; raw audio is
never persisted beyond the request that carried it.

### Keeping the two stages apart

This is enforced, not just documented:

- `/api/analyze` returns `stage: "transcription"` and
  `pronunciation_assessed: false` in every response.
- A test asserts no scoring field (`score`, `gop`, `deviation`, `similarity`)
  can appear on the endpoint.
- The frontend stores `transcription` separately from `result` on each
  attempt, and renders it as a distinct "Stage 1" panel that says in plain
  words that it is not a pronunciation score.
- `transcribe()` has **no fixture fallback**. A transcript is either real or
  absent — inventing one would be the exact failure this project avoids.

The reason is not pedantry. Whisper is a language model with a strong prior:
it repairs "wabbit" into "rabbit". It is a good signal for *which word* was
attempted and a useless one for *how the sounds were made*.

### Not built yet

~~`/api/sounds`, `/api/prompts`, `/api/attempts`, `/api/exercises`, and
`/api/sessions/{id}/progress` answer **501**, not 404.~~ All are now served;
the 501 placeholders and the machinery behind them are gone from `main.py`.
The note below is kept because the reasoning still applies to the next
placeholder anyone adds. The frontend treats 501
as "service up, feature missing" and falls back to its labelled development
fixture; 404 would be indistinguishable from a routing bug. Each placeholder
is deleted as its stage lands.

---

## 14. Acoustic pronunciation analysis (implemented)

Stage 2. `POST /api/pronunciation`, code in `api/app/acoustic/`.

**This is not what §3 planned.** §3 specifies wav2vec2 CTC posteriors with
forced alignment and GOP. What shipped is a signal-processing model built on
librosa, numpy, scipy and praat-parselmouth: smaller, CPU-only, ~40 ms per
attempt, and fully inspectable — every number in the response traces to a
measurement, and the comparison is arithmetic a reader can check. §3 remains
the upgrade path. The honest summary of the difference: alignment would
*locate* the target phoneme properly, where this stage *estimates* it from
acoustic landmarks.

### The pipeline

```
audio bytes
  -> preprocess   decode, DC-remove, peak-normalise, find the speech
  -> frames       one shared set of short-time measurements
  -> quality      stop here if the recording cannot support a verdict
  -> segment      estimate where the target sound is
  -> features     measure what distinguishes that target
  -> scoring      compare against the target and its alternatives
  -> feedback     say what was measured, and what to try next
```

Every step can decline. No path produces a number without audio behind it,
and a refusal reports `similarity_score: 0.0`, `confidence: 0.0` and an empty
feature set — not a small positive number a UI could render as a low score.

### Locating the target — the honest part

Without an aligner the target has to be found from the signal. Two landmark
detectors, both **target-independent**, so the search cannot bias the verdict
toward the sound we hope to find:

- **Fricatives** (`/s/`, `/th/`): the best contiguous run of
  `unvoiced × high-frequency share × above-the-noise-floor`. A product, not a
  sum — a loud vowel clears the floor but is voiced and low-frequency, and
  any one of those disqualifies it.
- **Approximants** (`/r/`, `/l/`): the voiced stretch at the expected word
  edge, measured where the formants are most stable. "Most stable formants
  near the word edge" says nothing about whether F3 will turn out low.

The estimate carries a `salience` in [0, 1] that feeds confidence, so a
segment we are unsure of cannot yield a verdict we are sure of.

### Features, per target family

| Family | Measured |
|---|---|
| Fricative | centroid, bandwidth, 85% rolloff, flatness, peak, spectral tilt, >4 kHz energy share, ZCR, voicing, duration, **intensity relative to the vowel in the same word** |
| Approximant | F1–F3, F3−F2, F2 and F3 over the speaker's own median F3, F2 transition slope, mid-band energy, release flux, duration |

Two decisions worth stating:

- **Relative, not absolute, intensity.** `rel_intensity_db` compares the
  target segment to the loudest frame of the same utterance. Absolute dB
  would measure the microphone. This is the best `/s/`-vs-`/θ/` feature: a
  dental fricative measures ~15 dB quieter than a sibilant for anyone.
- **MFCCs are reported but not scored.** In the response because a reader may
  want them; out of the comparison because they encode speaker and channel as
  strongly as phoneme. With a reference corpus this small, scoring on them
  would measure how much the learner sounds like the reference voice.

**Speaker normalisation** divides F2 and F3 by the speaker's own median F3.
The obvious version — F2 over median F2 — was tried and is wrong: over one
short word the median F2 is set by that word's vowel, so `/w/` in "walk"
normalised to 0.81 and measured exactly like `/l/`.

### Scoring

Gaussian naive Bayes over the target-specific features, diagonal covariance,
uniform priors:

```
z_ik    = (x_i - mu_ik) / sd_ik           per-feature standardised error
e_ik    = w_i * min(z_ik^2, 16)           clipped, weighted squared error
log L_k = -0.5 * SUM_i e_ik               naive-Bayes log-likelihood
p_k     = softmax_k(log L_k)              posterior over the candidates
sim_k   = exp(-0.5 * SUM_i e_ik / SUM_i w_i)   the same distance, per feature
conf    = p_top * trust(quality, salience, coverage)
```

The posterior uses the **sum** and the similarity the **mean**, deliberately.
The sum is the actual log-likelihood and is what makes the posterior sharp
enough to mean something; the mean is a per-feature distance, comparable
across targets and readable as "about one SD off". Using the mean for both
divided every distance by ~8 and flattened the posteriors so far that a
textbook `/s/` came back at 0.64 confidence.

Confidence is capped by the classifier's own posterior, so an ambiguous
classification cannot be diluted into a confident-looking number by the other
factors. `CONFIDENCE_FLOOR = 0.45`; below it `estimated_match` is `null` and
the message is exactly *"Unable to confidently assess this attempt."*

### Reference data

`app/acoustic/reference/profiles.json`, built by
`scripts/build_reference_profiles.py` from a 288-token synthesised corpus
(`build_reference_corpus.ps1`), measured through the same code path that
scores a learner. Nothing is hand-entered and nothing is copied from wideband
literature — at 16 kHz a textbook `/s/` centroid would be wrong by kilohertz.
Standard deviations are floored at estimates of real between-speaker
variation, with the measured spread kept alongside for comparison.

**Limitations are documented in full, with the measured numbers, in
`app/acoustic/reference/README.md`.** The short version: `/s/` and `/r/` are
clean (36/36, with `/θ/` never reported as `/s/` and `/w/` never as `/r/`);
`/l/`-vs-`/w/` is unreliable; `/θ/`-vs-`/f/` is genuinely hard and reports
lower confidence; there are two synthetic adult speakers and no children.

### Safety

`feedback.py` describes sounds, never speakers. No clinical vocabulary
appears in any learner-facing string, and `tests/test_safety_language.py`
asserts that across every message the product can emit.

---

## 15. The Adaptive Sound Journey (implemented)

`api/app/journey/`, `POST /api/journey/*`, UI in `web/src/pages/Journey.tsx`
and `web/src/components/SoundJourney.tsx`.

Seven stages per sound, grouped into the five bands the learner sees:

```
1 isolated  2 syllable | 3 word_simple  4 word_complex | 5 phrase | 6 sentence | 7 conversation
       Sound           |            Word               |  Phrase  | Sentence   | Conversation
```

Stages 1 and 2 share a band: stage 1 is a sustained sound with no vowel to
hide behind, stage 2 is the first time it has to be released into one. That
transition is where a lot of `/s/` and `/r/` practice actually breaks down,
so it gets its own step. Seven dots would be unreadable at a glance; the
caption names the actual stage so nothing is hidden by the grouping.

### The division of labour

```
material.py   a language model writes the exercise
policy.py     the acoustic measurement decides whether it was passed
```

Nothing generated ever reaches `policy.decide()`. Enforced three ways, not
one: `StageMaterial` sets `extra="forbid"`, so a response carrying a score
fails validation outright rather than being quietly ignored; every field is a
string, so there is no numeric field to fill even if the model wanted to; and
the endpoint measures the recording separately and never passes generated
text to the policy. `test_journey_material.py` asserts each.

Generated material is also **verified before use** — the target sound must
actually start the first word, checked against spelling in code. Material
that does not contain the sound being practised would corrupt the
measurement, which is subtler than a wrong score and worse.

The **fallback bank is not a degraded mode**. It is hand-written, covers
every stage of every sound, and runs with no API key, no network, a timeout,
or a rejected response. The demo never depends on a network call.

### The policy

A pure function of past outcomes at the current stage. Rules, in order:

1. last attempt unassessable → **hint**, retry the stage
2. two decisive passes → **advance**
3. two decisive failures → **retreat**
4. mixed → **hold**, with different material

Unclear attempts are dropped from streaks entirely, not treated as neutral
entries that reset them: a learner who passes, hits background noise, then
passes again has succeeded twice. Counting an unmeasurable recording as a
failure would push someone backwards for sitting in a noisy room.

Outcomes are scoped to the stage they were made at. A failure at stage 5 says
nothing about stage 3, and carrying it over would make retreating a trap —
the learner would arrive at the simpler stage already holding the failures
that sent them there.

### Persistence

`app/journey/store.py`, stdlib `sqlite3`, two tables. **No audio and no
transcripts are written to disk** — the schema has no column they could go
in, so no later change can start persisting recordings by accident. The
`learner_id` is an opaque value the browser generates and keeps in local
storage; it is not an account and carries no personal data.

### Known limits

- Every journey item is word-initial, so `position` is always `onset`.
  Practising a sound mid-word is valuable, but the segmenter locates a medial
  approximant far less reliably, and advancing people on an unreliable
  measurement would be worse than covering less ground. The `/api/attempts`
  prompt bank does carry coda and medial positions.
- At stages 5–7 only the **first occurrence** is measured; the response says
  so via `first_occurrence_only`.
- Stage 7 uses sentence openers the learner completes, rather than free
  answers to a question, because the target must start the utterance for the
  measurement to be valid.
- `groq_chat_model` must be a model the account can actually reach.
  `llama-3.3-70b-versatile` returns 404 `model_not_found` on this key;
  `openai/gpt-oss-120b` works. `max_tokens` is 1200 because the gpt-oss
  family spends its budget on reasoning before emitting any JSON — at 300 the
  longer stages returned HTTP 400 with an empty `failed_generation`.

---

## 16. Multilingual support (implemented)

`api/app/languages.py`, `GET/PUT /api/journey/{learner}/profile`,
`GET /api/journey/languages`, UI in `web/src/components/LanguageBar.tsx` and
`BridgeStrip.tsx`.

MVP languages: **English** and **Bangla**. The case it is built around is a
Bangla-speaking learner practising English /θ/.

### The one decision everything else follows from

A learner's first language affects exactly three things:

```
1. the interface       names, scripts, and which sounds are offered
2. the bridge          a familiar sound used as a starting point
3. the material prompt context given to the exercise generator
```

It affects **nothing else**, and in particular it is never an input to the
acoustic measurement. `acoustic.analyze()` has no parameter through which a
language could reach it — `test_the_acoustic_stage_takes_no_language_argument`
asserts the signature, and
`test_the_same_recording_scores_identically_whatever_the_first_language`
asserts the behaviour on byte-identical audio through the real endpoint. The
browser suite repeats the same comparison end to end.

That separation does two jobs at once. It is what stops the feature
destabilizing the pipeline: adding a language cannot change what an existing
recording scores. And it is the only honest option, because the reference
profiles are English audio (§14). There is no Bangla acoustic data, so
**Bangla can be a native language here but not a target one** — the registry
says so via `can_be_target: False`, and the UI shows that note at the moment
the choice is made *and* keeps showing it afterwards.

### Framing: personalization, not causation

The feature is stated as: *PhonoPlay can personalize practice for learners
whose first language differs from their target language.*

Nothing claims that a first language causes a pronunciation pattern. That
claim would need evidence about individual learners that a two-second
recording cannot supply, and stated carelessly it turns a description of a
language into a prediction about a person.

What the bridges say is narrower and checkable: that a sound in one language
is articulated in a particular place, and a sound in another shares that
place. "থ puts the tongue tip at the teeth, and so does /θ/" describes two
articulations. `test_no_bridge_copy_makes_a_causal_or_deficit_claim` scans
every user-facing bridge string for causal and deficit wording — *because*,
*lacks*, *missing*, *struggle*, *tend to*, *unable to* — and the generator's
system prompt forbids the model from adding any.

### The bridges

Each is a **shared place of articulation**, chosen because Bangla's dental
stop series (ত থ দ ধ) is laminal dental, ল makes alveolar contact, and র is
an alveolar tap or trill.

| Target | Anchor | Progression |
|---|---|---|
| /th/ | থ /t̪ʰ/ | থ → θ → think → three → through |
| /s/ | স /s ~ ʃ/ | স → s → sun → snake → street |
| /r/ | র /ɾ ~ r/ | র → ɹ → red → rain → rocket |
| /l/ | ল /l/ | ল → l → light → leaf → lemonade |

Every word begins with its target sound, because the journey measures the
onset of the utterance (§15) — a progression word that did not would be
unmeasurable. `test_every_bridge_word_is_practisable` checks this with the
same function that validates generated material.

An English speaker has no cross-language anchor, so the progression starts at
the target sound: θ → think → three → through. **English-only mode is not a
degraded path.** It is the default, needs no configuration, and the
native-language row does not render at all when the two languages match.

### Generated material

The learner's first language is passed to Groq as context, narrowly: prefer
everyday words familiar in that cultural context, the word must still be an
English word, and do not explain their pronunciation by reference to their
first language. The deterministic bank is *not* varied by language — the
words that isolate an English /s/ are the same words whoever is practising,
and maintaining parallel English word lists with no reason to differ would
be duplication, not localisation.

### Rendering

Bengali needs its own face: Outfit has no Bengali glyphs, so বাংলা would fall
back to whatever the OS picked and sit at a different optical size beside the
Latin text. `--font-bengali` loads Noto Sans Bengali and names the system
fallbacks. The `.script-bengali` class is applied per element, because the
interface is in English and only the language's own name and the anchors are
in Bengali.

IPA gets `--font-ipa` and the `.ipa` class. Two reasons, both found by
looking at the rendered page: neither Outfit nor IBM Plex Mono carries the
combining dental diacritic U+032A, so /t̪ʰ/ rendered as a box; and the
`.label-mono` class it was originally given applies `text-transform:
uppercase`, which for IPA is not a styling choice but a change of meaning.

### Known limits

- Two languages. Adding a third means adding a registry entry and researched
  bridges; there is no automatic path, and there should not be one — an
  invented bridge is worse than none, which is why `bridge_for()` returns
  `None` rather than improvising.
- Bangla is native-only until there is Bangla reference audio.
- The interface itself is in English. Only language names and anchors are in
  the learner's script; full interface translation is not in scope here.
- The bridges cover word-initial position only, following §15.

---

## 17. Privacy, safety, and responsible-AI safeguards (implemented)

`api/app/safety.py`, `web/src/lib/safety.ts`, `GET /api/safety`, and the
learner-facing surface in `web/src/components/HowItWorks.tsx`. The full
user-facing version is [README.md](README.md).

### The promised sentences live in one place

Three exact wordings the product commits to:

| Constant | When |
|---|---|
| `DISCLAIMER` | wherever a result is shown |
| `UNCERTAIN` | confidence below the floor |
| `ANALYSIS_FAILED` | the analysis could not run at all |

They are defined once in `app/safety.py`, mirrored once in `lib/safety.ts`,
and asserted character-for-character in `tests/test_privacy.py` and the
browser suite. A commitment that exists in four slightly different wordings
across three files is one nobody can check.

The frontend duplicates rather than fetches them: a disclaimer that
disappears when the network does is not a disclaimer.

### One headline for every failure

`for_blocked()` returns the same `message` whatever went wrong, with the
specific cause in a new `detail` field. Previously each cause had its own
headline — "That recording is too short to measure" sits close enough to a
verdict to be read as one. A fixed headline cannot be mistaken for a score;
`detail` loses nothing.

Every refusal reports `similarity_score: 0.0`, `confidence: 0.0` and an empty
feature set. Not a small positive number a UI could render as a low score.

### Where audio goes, stated per stage

| Stage | Leaves the server | Why |
|---|---|---|
| Acoustic analysis | no | runs locally in `app/acoustic/` |
| Transcription | **yes** | `POST /api/analyze` sends the recording to Groq |
| Material generation | no | receives text only |

The middle row is the one that matters. "We don't store your audio" is easy
to say and often not the whole truth; this stage genuinely transmits it to a
third party, and the disclosure says so in the interface rather than in a
footnote. `STT_PROVIDER=fake` removes the transmission and costs only stage 1.

`test_only_the_transcription_provider_uploads_audio` scans the source: a
multipart file upload may appear in `app/stt/` and nowhere else.

### Data minimisation

Stored: an opaque browser-generated id and per-attempt outcomes. Nothing
else. No audio column, no transcript column, no field that could hold a name,
an age, or a location — asserted against both the wire schemas and the live
database schema, so a field added later fails the build.

**Pitch is computed but not reported.** `f0` is needed upstream for per-frame
voicing, is used by no reference profile, and is the most age- and
sex-correlated number the stage can produce. Removing it from the response
was a real change, not a copy change. The formant medians stay because they
are the denominator that normalises F2 and F3 — a measurement input with no
interpretation attached.

Note also that the fricative path produces **no speaker block at all**: /s/
and /th/ are scored without any speaker-level measurement.

### What is not claimed

`NOT_CLAIMED` states the limits in the interface, not only in a document: no
diagnosis; cannot separate a pronunciation pattern from an accent, a regional
variant, a head cold, or a poor microphone; two synthesised adult voices in
the reference set, so least reliable for the children it is for; and a result
is about one recording, not about a person.

`test_no_claim_of_clinical_accuracy` checks the disclosures for overreach in
the other direction.
