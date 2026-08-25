# Reference profiles — what they are, and what they are not

`profiles.json` is the reference data the acoustic stage compares recordings
against. This file explains where every number in it came from and, more
importantly, where it stops being trustworthy.

## How it was built

```
scripts/build_reference_corpus.ps1     288 WAVs, 16 kHz mono
scripts/build_reference_profiles.py    -> app/acoustic/reference/profiles.json
scripts/evaluate.py                    -> the numbers in this file
```

The corpus is **synthesised speech**: two Windows SAPI voices (Microsoft
David, Microsoft Zira) reading six word-initial words per phoneme at three
speaking rates. Each token is measured through the *same* code path that
scores a learner — `preprocess → frames → segment → features` — and each
profile entry is the median of those measurements, with a MAD-derived spread.

Two properties of that process matter:

- **Nothing is hand-entered.** No value is copied from a phonetics textbook,
  and none is chosen to make a demo look good. Rebuilding the corpus rebuilds
  the profiles.
- **Measured at 16 kHz.** Published fricative figures are usually wideband.
  /s/ energy extends past 10 kHz, and above 8 kHz we cannot see it, so a
  textbook /s/ centroid would be wrong here by kilohertz. Measuring at the
  bandwidth we actually score at is what keeps the comparison valid.

Standard deviations are **floored** at estimates of real between-speaker
variation (`SD_FLOOR` in the builder). Two synthetic voices vary far less
than real speakers do, and using the measured spread directly would make the
model wildly overconfident — every genuine human recording would read as an
outlier. Each profile entry keeps `measured_sd` alongside the floored `sd`,
so the gap is visible rather than hidden.

## What it does well

From `scripts/evaluate.py`, analysing every corpus token of a target *and of
its documented substitutions* — the second half being the "intentionally
altered sound" case:

| Target | Correct productions | Substitutions correctly rejected |
|---|---|---|
| **/s/** | 36/36 | /θ/, /ʃ/, /t/ — **0** ever reported as /s/ |
| **/r/** | 36/36 | /w/ — **0** ever reported as /r/ |
| **/th/** | 18/36 (+7 uncertain) | /s/, /t/ — **0** ever reported as /θ/ |
| **/l/** | 28/36 (+1 uncertain) | /r/ — **0** ever reported as /l/ |

Overall in-sample identification is **426/504 (84.5%)**, and precision among
the recordings that get named is **88.4%** at the 0.45 confidence floor.

The two flagship cases are clean. A /θ/ produced where /s/ was asked for is
never scored as a correct /s/ (similarity 0.86 for real /s/ against 0.01 for
/θ/), and a /w/ produced where /r/ was asked for is never scored as a correct
/r/ (0.81 against 0.04). Those are the patterns PhonoPlay exists to detect.

## What it does not do well — the honest list

**1. /l/ versus /w/ is unreliable.** 12 of 36 /w/ tokens are reported as /l/.
An l→w pattern will frequently be missed. The measured cause is specific: the
two sounds differ mainly in F2 and in whether the tongue tip releases, and
with two speakers the profiles overlap.

**2. /θ/ versus /f/ is genuinely hard, and it shows.** 11 of 36 /θ/ tokens
read as /f/, 6 of 36 the other way. This is not an implementation defect —
/θ/ and /f/ are among the most confusable pairs in English for human
listeners too, at low amplitude and with nearly flat spectra. The stage
reports lower confidence here (0.72 against 0.98 for /s/), which is the
correct behaviour, but it does not solve the problem.

**3. Errors are speaker-dependent, and there are only two speakers.** The
/l/ failures split *within* words across the two voices — "lake" and "leaf"
are each 3 correct and 3 wrong — which means the boundary is being set by
speaker identity, not by the word. Two synthetic adult voices cannot
represent the population PhonoPlay is for. **Children in particular are
absent**, and children's formants sit several hundred Hz above adults'.
Speaker normalisation (dividing by the speaker's own median F3) removes some
of this, not all.

**4. Synthetic speech is not human speech.** TTS is cleaner, more
consistent, and articulated more canonically than a learner in a room with a
laptop microphone.

**5. Confidence detects bad recordings, not close calls.** Raising the
confidence floor from 0.45 to 0.70 changes precision only from 86.7% to
88.2% while discarding 12% of attempts. Confidence works well for what the
quality and salience terms measure — noise, clipping, no speech, no locatable
target — and is only weakly predictive of which of two *similar* phonemes was
produced. The floor is set at 0.45 for that reason: pushing it higher buys
almost no precision and costs real coverage.

**6. A corpus of single-syllable words hides window-length faults.** The
onset window used to be allowed to run to 130 ms — longer than the sound it
was bounding. In a word with a long voiced run it reached past the
constriction into the following vowel, and because a vowel is flatter than an
approximant the reading was then taken from the vowel. A correct /r/ in
"rabbit" came back as an /l/ substitution at similarity 0.038.

Every corpus word is measured the same way the profiles were built, so the
corpus scored itself as correct and could not see this at all. It was found
by analysing a held-out recording, and it is now bounded at 80 ms with a test
fixture guarding it. Worth stating plainly as a limitation of the method:
**an in-sample corpus cannot detect a fault it shares with the reference.**

**7. Every accuracy figure above is in-sample.** The profiles were built from
this corpus. Held-out behaviour is exercised by the test fixtures, which are
synthesised separately from words that are not in the corpus.

## What this is not

Not a clinical instrument, and not evidence about a speaker. It measures how
one recording of one sound compares to a small reference set. It cannot
distinguish a pronunciation pattern from an accent, a regional variant, a
head cold, or a cheap microphone. Nothing it produces is a diagnosis, and no
part of the system should present it as one.

## Improving it

In rough order of how much each would help:

1. **More speakers, including children.** The single highest-value change.
   Everything in the "does not do well" list traces back to two voices.
2. **Real recordings rather than TTS**, with phoneme-level labels.
3. **Per-pair feature weighting.** Weights are per-family today, so the
   features that separate /l/ from /w/ carry the same weight when the real
   contest is /l/ against /r/.
4. **Wideband audio.** 16 kHz costs us the top of the /s/ spectrum. Capturing
   at 32 kHz or better would sharpen every sibilant contrast.
5. **Forced alignment** (wav2vec2 CTC + `torchaudio.forced_align`) to replace
   landmark detection with a real phoneme alignment — ARCHITECTURE.md §3
   describes this path.
