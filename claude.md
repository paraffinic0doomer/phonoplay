# PhonoPlay — Claude Code Instructions

## PRODUCT

PhonoPlay is an AI-powered personalized pronunciation learning platform.

Core idea:

> Your pronunciation writes your syllabus.

The user selects their first language and target language, completes a pronunciation assessment, receives a personalized learning path, practices pronunciation, receives AI-generated exercises, and progresses based on actual performance.

PhonoPlay supports two learning modes:

1. Standard Mode
2. Accessibility Mode

Accessibility Mode provides additional phonological practice strategies for learners who benefit from smaller learning steps, additional repetition, minimal-pair exercises, slower progression, and multimodal feedback.

It is NOT a medical diagnostic or treatment system.

---

# GIT RULE — CRITICAL

The repository owner is the only Git author.

Claude MUST NOT:

- git commit
- git push
- git config user.name
- git config user.email
- create commits
- amend commits
- create tags
- modify Git history
- add Co-authored-by
- add Claude as a contributor

Claude MAY:

- git status
- git diff
- git log
- inspect branches
- modify source code
- install dependencies
- run tests
- run builds

All commits and pushes are performed manually by the repository owner.

---

# INFRASTRUCTURE

This is a hackathon prototype.

Do NOT introduce:

- Supabase
- PostgreSQL
- Firebase
- MongoDB
- authentication
- user accounts

Use local persistence.

Preferred:

IndexedDB + Dexie.js

The application should work immediately without registration.

---

# CORE LOOP

ASSESS
→ PROFILE
→ GENERATE SYLLABUS
→ PRACTICE
→ ANALYZE
→ UPDATE LEARNER MODEL
→ ADAPT
→ PRACTICE AGAIN

---

# AI PRINCIPLES

Do not fabricate pronunciation scores.

Whisper is speech-to-text.

Do NOT treat Whisper transcription as phoneme-level pronunciation assessment.

Keep separate:

Speech Recognition
+
Acoustic Analysis

The acoustic analysis provides pronunciation evidence.

The LLM generates:

- exercises
- explanations
- practice content
- educational feedback

The LLM must not invent pronunciation measurements.

---

# MVP

Target language:

English

MVP target sounds:

/s/
/r/
/l/
/th/

Support:

- pronunciation
- word-level practice
- phrase-level practice
- sentence-level practice
- basic rhythm/stress where technically feasible

---

# ACCESSIBILITY MODE

Accessibility Mode is NOT a dyslexia diagnosis or treatment mode.

It is an adaptive learning mode.

Features:

- phoneme isolation
- minimal pairs
- smaller learning steps
- slower difficulty progression
- increased repetition
- visual pronunciation cues
- audio cues
- text + audio reinforcement
- reduced cognitive load
- no punitive failure
- explicit progress feedback

Example progression:

sound
→ syllable
→ word
→ minimal pair
→ phrase
→ sentence

---

# ACCESSIBILITY LANGUAGE

Never say:

- "You have dyslexia."
- "This treats dyslexia."
- "This diagnoses dyslexia."
- "This fixes your speech disorder."

Prefer:

- "Accessibility Mode"
- "phonological practice"
- "additional sound practice"
- "smaller learning steps"
- "targeted repetition"
- "sound contrast practice"

If appropriate:

"Accessibility Mode may be useful for learners who benefit from additional phonological practice."

---

# PRODUCT PRIORITY

1. Real audio analysis
2. Personalized syllabus
3. Adaptive progression
4. Accessibility Mode
5. Sound Lab
6. AI-generated exercises
7. Game/reward layer
8. Visual polish

Do not add unrelated features.

---

# FINAL DEMO

The demo should demonstrate:

Language selection
→ assessment
→ pronunciation profile
→ personalized syllabus
→ accessibility mode
→ difficult sound
→ minimal-pair practice
→ recording
→ analysis
→ AI-generated exercise
→ retry
→ improvement
→ adaptive next lesson