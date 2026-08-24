from app.learner import build_state, recommended_difficulty, trend


def test_adaptive_difficulty_uses_documented_bands():
    assert recommended_difficulty(40) == "isolated_sound"
    assert recommended_difficulty(60) == "simple_words"
    assert recommended_difficulty(75) == "multisyllabic_words"
    assert recommended_difficulty(85) == "short_phrases"
    assert recommended_difficulty(92) == "sentences_speed_variation"


def test_trend_detects_improving_stable_declining_and_inconsistent():
    assert trend([71, 75, 83]) == "improving"
    assert trend([78, 79, 79]) == "stable"
    assert trend([88, 80, 72]) == "declining"
    assert trend([91, 61, 88]) == "inconsistent"


def test_state_uses_recent_acoustic_scores_and_common_feedback():
    state = build_state(
        "/s/",
        [55, 71, 74, 78, 80, 82],
        ["TARGET_SOUND_MISMATCH_TH", "TARGET_SOUND_MISMATCH_TH", "ON_TARGET"],
    )

    assert state.attempt_count == 6
    assert state.recent_scores == (71.0, 74.0, 78.0, 80.0, 82.0)
    assert state.mastery == 77.0
    assert state.trend == "improving"
    assert state.recommended_difficulty == "multisyllabic_words"
    assert state.common_feedback_codes[0] == "TARGET_SOUND_MISMATCH_TH"