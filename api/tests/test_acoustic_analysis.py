"""
Controlled tests for the acoustic pronunciation stage.

Every audio fixture here is a **held-out** recording: none of these words
appear in the reference corpus the profiles were built from. That distinction
is what makes the assertions worth anything — an accuracy claim measured on
the data the model was fitted to is a claim about nothing.

The suite is organised around the states the stage can end in, because the
refusals matter as much as the verdicts:

    correct production        -> the target, with high similarity
    altered production        -> the substitution, and never the target
    unusable recording        -> a blocking code, and no score at all
    ambiguous recording       -> no phoneme named
"""

from __future__ import annotations

import pytest

from app.acoustic import analyze
from app.acoustic.feedback import (
    ON_TARGET,
    UNABLE_TO_ASSESS,
    UNCERTAIN_MESSAGE,
    substitution_code,
)
from app.acoustic.scoring import CONFIDENCE_FLOOR, ON_TARGET_SIMILARITY


# ── Correct productions ──────────────────────────────────────────────


def test_correct_s_is_identified(sank_wav):
    result = analyze(sank_wav, "s", expected_text="sank")

    assert result.estimated_match == "s"
    assert result.feedback_code == ON_TARGET
    assert result.similarity_score >= ON_TARGET_SIMILARITY
    assert result.confidence >= CONFIDENCE_FLOOR
    assert result.assessed is True


def test_correct_s_is_identified_for_a_second_speaker(sank_zira_wav):
    """Guards against tuning that only works for one voice."""
    result = analyze(sank_zira_wav, "s", expected_text="sank")

    assert result.estimated_match == "s"
    assert result.similarity_score >= ON_TARGET_SIMILARITY


@pytest.mark.parametrize(
    ("fixture", "target", "word"),
    [
        ("thank_wav", "th", "thank"),
        ("rag_wav", "r", "rag"),
        ("lace_wav", "l", "lace"),
    ],
)
def test_correct_production_of_each_target(request, fixture, target, word):
    result = analyze(request.getfixturevalue(fixture), target, expected_text=word)

    assert result.estimated_match == target
    assert result.similarity_score >= ON_TARGET_SIMILARITY


# ── Altered productions ──────────────────────────────────────────────


def test_s_produced_as_th_is_not_scored_as_a_correct_s(thank_wav):
    """
    The flagship case: "thank" offered where "sank" was asked for.

    The assertion that matters is the second one. Naming the substitution is
    useful; never mistaking it for a correct /s/ is what the product depends
    on.
    """
    result = analyze(thank_wav, "s", expected_text="sank")

    assert result.estimated_match == "th"
    assert result.feedback_code == substitution_code("s", "th")
    assert result.similarity_score < 0.2


def test_th_produced_as_s_is_not_scored_as_a_correct_th(sank_wav):
    result = analyze(sank_wav, "th", expected_text="thank")

    assert result.estimated_match == "s"
    assert result.similarity_score < 0.2


def test_l_produced_as_r_is_detected(race_wav):
    result = analyze(race_wav, "l", expected_text="lace")

    assert result.estimated_match == "r"
    assert result.feedback_code == substitution_code("l", "r")


def test_r_produced_as_w_is_never_accepted_as_a_correct_r(wag_wav):
    """
    "wag" offered where "rag" was asked for.

    Only the rejection is asserted, not the label. /w/ and /l/ overlap in the
    current reference set and this fixture is in fact reported as /l/ — a
    known and documented limitation (see reference/README.md). Asserting the
    label would encode that weakness as expected behaviour; asserting the
    rejection tests the guarantee the product actually makes.
    """
    result = analyze(wag_wav, "r", expected_text="rag")

    assert result.estimated_match != "r"
    assert result.similarity_score < 0.2


# ── Unusable recordings ──────────────────────────────────────────────


@pytest.mark.parametrize(
    ("fixture", "expected"),
    [
        ("silence_wav", "NO_SPEECH_DETECTED"),
        ("white_noise_wav", "NO_SPEECH_DETECTED"),
        ("tiny_wav", "NO_SPEECH_DETECTED"),
        ("room_noise_wav", "AUDIO_TOO_NOISY"),
        ("noisy_speech_wav", "AUDIO_TOO_NOISY"),
        ("clipped_wav", "AUDIO_CLIPPED"),
    ],
)
def test_unusable_audio_is_refused(request, fixture, expected):
    result = analyze(request.getfixturevalue(fixture), "s")

    assert result.feedback_code == expected
    assert result.estimated_match is None
    assert result.assessed is False


@pytest.mark.parametrize(
    "fixture",
    ["silence_wav", "white_noise_wav", "room_noise_wav", "noisy_speech_wav", "clipped_wav"],
)
def test_a_refused_recording_carries_no_score(request, fixture):
    """
    The core promise. A refusal reports zero similarity and zero confidence —
    not a small positive number that a UI could render as a low score, and
    not a feature dictionary that could be mistaken for a measurement.
    """
    result = analyze(request.getfixturevalue(fixture), "s")

    assert result.similarity_score == 0.0
    assert result.confidence == 0.0
    assert result.acoustic_features == {}
    assert result.candidates == []


def test_noisy_speech_is_refused_rather_than_guessed(noisy_speech_wav):
    """
    Real speech buried in noise. Before the SNR gate was derived from the
    reference intensities this fixture returned a confident /s/ -> /t/
    substitution, because broadband noise flattens the frication spectrum
    into something that measures like a stop burst. Confidently wrong is the
    worst available outcome, so the gate refuses instead.
    """
    result = analyze(noisy_speech_wav, "s", expected_text="sank")

    assert result.assessed is False
    assert result.estimated_match is None


def test_undecodable_bytes_raise_rather_than_score(not_audio):
    from app.acoustic import SignalError

    with pytest.raises(SignalError):
        analyze(not_audio, "s")


# ── Consistency and contract ─────────────────────────────────────────


def test_repeated_analysis_is_deterministic(sank_wav):
    """No randomness anywhere in the measurement path."""
    first = analyze(sank_wav, "s")
    second = analyze(sank_wav, "s")

    assert first.similarity_score == second.similarity_score
    assert first.confidence == second.confidence
    assert first.acoustic_features == second.acoustic_features


def test_confidence_below_the_floor_names_no_phoneme(monkeypatch, sank_wav):
    """
    Raising the floor above what any recording can reach must produce a
    refusal, not a low-confidence guess.
    """
    monkeypatch.setattr("app.acoustic.scoring.CONFIDENCE_FLOOR", 1.01)
    result = analyze(sank_wav, "s")

    assert result.estimated_match is None
    assert result.feedback_code == UNABLE_TO_ASSESS
    assert result.message == UNCERTAIN_MESSAGE


def test_candidates_are_ranked_and_normalised(sank_wav):
    result = analyze(sank_wav, "s")
    posteriors = [c["posterior"] for c in result.candidates]

    assert posteriors == sorted(posteriors, reverse=True)
    assert sum(posteriors) == pytest.approx(1.0, abs=0.01)
    # Every candidate must show its working.
    assert all(c["z_scores"] for c in result.candidates)


def test_features_are_target_specific(sank_wav, rag_wav):
    """A fricative and an approximant are not measured with the same numbers."""
    fricative = set(analyze(sank_wav, "s").acoustic_features)
    approximant = set(analyze(rag_wav, "r").acoustic_features)

    assert "centroid_hz" in fricative and "centroid_hz" not in approximant
    assert "f3_over_speaker_f3" in approximant
    assert "f3_over_speaker_f3" not in fricative


def test_an_unsupported_target_is_rejected(sank_wav):
    with pytest.raises(ValueError, match="not a practice target"):
        analyze(sank_wav, "zz")


def test_the_stage_is_labelled_and_carries_its_evidence(sank_wav):
    result = analyze(sank_wav, "s")

    assert result.stage == "acoustic"
    assert result.segment_info["method"] == "frication-run"
    assert 0.0 < result.segment_info["salience"] <= 1.0
    assert result.reference["tokens"] > 0
    assert result.mfcc, "MFCCs are reported even though they are not scored"


def test_mfccs_are_reported_but_do_not_affect_the_score(sank_wav):
    """
    MFCCs are deliberately excluded from the comparison — see
    app/acoustic/features.py. This asserts the exclusion holds by checking no
    candidate ever used them as a scored feature.
    """
    result = analyze(sank_wav, "s")

    assert len(result.mfcc) == 13
    for candidate in result.candidates:
        assert not any(name.startswith("mfcc") for name in candidate["z_scores"])
