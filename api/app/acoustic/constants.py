"""
Framing and analysis constants shared across the acoustic stage.

Everything here is a deliberate choice, not a default that happened to work.
Where a value trades one thing off against another, the comment says which.
"""

from __future__ import annotations

#: The acoustic stage only ever sees the normalized signal that
#: `audio/ingest.py` produces. Fixing it here means no module has to ask.
SAMPLE_RATE = 16000

#: Nyquist. Worth naming, because it is a real constraint on what we can
#: measure: /s/ frication extends well past 8 kHz in wideband recordings, so
#: every spectral figure below is a *band-limited* measurement. Reference
#: profiles are stated for this band, never copied from wideband literature
#: without correction. See reference/README.md.
NYQUIST = SAMPLE_RATE // 2

#: 25 ms analysis window. Long enough for stable spectral estimates down to
#: ~80 Hz bins, short enough that a 60 ms fricative still gets its own frames.
WIN_LENGTH = 400
#: 512-point FFT -> 31.25 Hz resolution.
N_FFT = 512
#: 5 ms hop. Phoneme boundaries in running speech move faster than the usual
#: 10 ms; at 5 ms a 40 ms stop burst is still eight frames.
HOP_LENGTH = 80

FRAME_S = HOP_LENGTH / SAMPLE_RATE

#: Below this a "segment" is a handful of frames and every measurement on it
#: is noise. Shorter candidates are rejected rather than scored.
MIN_SEGMENT_S = 0.025
#: Nothing in English needs more than this for a single consonant; a longer
#: run means the detector latched onto something else.
MAX_SEGMENT_S = 0.400

#: Frequency split used for the sibilance measurements. 4 kHz sits between
#: the /ʃ/ peak (~2.5-4 kHz) and the /s/ peak (~5-8 kHz at this bandwidth).
SIBILANT_SPLIT_HZ = 4000.0

#: Formant search ceiling for the Burg tracker. 5000 Hz with 5 formants is
#: the standard adult-male setting; 5500 is the usual adult-female one. We
#: use 5000 and lean on speaker normalisation rather than guessing a voice
#: category we have no way to verify.
FORMANT_CEILING_HZ = 5000.0
FORMANT_COUNT = 5
FORMANT_TIME_STEP = 0.005

#: Anything at or above this magnitude counts as clipped.
CLIP_THRESHOLD = 0.98
