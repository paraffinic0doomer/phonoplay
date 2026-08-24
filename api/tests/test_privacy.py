"""
Privacy and data-handling guarantees, asserted rather than asserted-to.

A privacy policy is a claim. These are the checks that make the claims true
in a way a later change cannot quietly undo: that no audio survives a
request, that nothing resembling personal information can be stored, that
only one code path sends a recording off this machine, and that a failed
analysis never carries a number.
"""

from __future__ import annotations

import re
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import safety
from app.acoustic import analyze
from app.audio import ingest
from app.config import Settings, get_settings
from app.journey.store import JourneyStore, set_store
from app.main import app
from app.schemas import PronunciationResponse, TranscriptionResponse

APP_DIR = Path(__file__).resolve().parents[1] / "app"


@pytest.fixture
def client(tmp_path):
    store = JourneyStore(tmp_path / "journey.db")
    set_store(store)
    app.dependency_overrides[get_settings] = lambda: Settings(
        stt_provider="fake", groq_api_key="", groq_api_keys="", groq_keys_file="/nonexistent"
    )
    try:
        with TestClient(app) as test_client:
            set_store(store)
            yield test_client
    finally:
        app.dependency_overrides.clear()
        set_store(None)
        store.close()


# ── No audio survives a request ──────────────────────────────────────


def test_the_scratch_file_is_removed_even_when_the_body_raises():
    """
    `finally`, not a happy-path cleanup. The one file audio ever touches must
    go away when the request that carried it fails, which is precisely when a
    cleanup written after the work would be skipped.
    """
    captured: list[str] = []

    with pytest.raises(RuntimeError):
        with ingest._scratch_file(b"RIFFsome-audio-bytes") as path:
            captured.append(path)
            assert Path(path).exists()
            raise RuntimeError("boom")

    assert captured and not Path(captured[0]).exists()


async def test_a_full_analysis_leaves_no_audio_on_disk(sank_wav, settings):
    """End to end: ingest, transcode, measure, and leave nothing behind."""
    temp_dir = Path(tempfile.gettempdir())
    before = set(temp_dir.glob("phonoplay-*"))

    normalized = await ingest.normalize(sank_wav, settings)
    result = analyze(normalized.data, "s", expected_text="sank")

    assert result.assessed is True
    assert set(temp_dir.glob("phonoplay-*")) == before


def test_the_journey_database_cannot_hold_audio(client, sank_wav, tmp_path):
    """
    The schema is the guarantee. After a real attempt, no column holds
    anything binary, and no column name suggests one ever could.
    """
    client.post(
        "/api/journey/privacy-1/s/attempt",
        files={"audio": ("attempt.wav", sank_wav, "audio/wav")},
        data={"prompt_text": "sank"},
    )

    from app.journey.store import get_store

    store = get_store()
    tables = [
        row["name"]
        for row in store._db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
            " AND name NOT LIKE 'sqlite_%'"
        ).fetchall()
    ]
    for table in tables:
        columns = store._db.execute(f"PRAGMA table_info({table})").fetchall()
        for column in columns:
            name, declared = column[1].lower(), (column[2] or "").upper()
            assert "BLOB" not in declared, f"{table}.{name} is a BLOB"
            assert not any(
                word in name for word in ("audio", "wav", "recording", "blob", "waveform")
            ), f"{table}.{name} looks like audio storage"

    # And the file itself contains none of the uploaded bytes.
    database = (tmp_path / "journey.db").read_bytes()
    assert sank_wav[:64] not in database


def test_transcripts_are_not_stored_either(client, sank_wav):
    """
    What a learner said is as personal as how they said it. The attempt row
    keeps the prompt they were *asked* to say, never what came back from
    speech-to-text.
    """
    from app.journey.store import get_store

    client.post(
        "/api/journey/privacy-2/s/attempt",
        files={"audio": ("attempt.wav", sank_wav, "audio/wav")},
        data={"prompt_text": "sank"},
    )
    columns = {
        row[1]
        for row in get_store()._db.execute("PRAGMA table_info(attempts)").fetchall()
    }

    assert "transcript" not in columns
    assert "prompt_text" in columns


# ── Only one path sends audio off the machine ────────────────────────


def test_only_the_transcription_provider_uploads_audio():
    """
    The privacy copy says the acoustic measurement is local and only
    speech-to-text sends a recording anywhere. This is what keeps that true:
    a multipart file upload may appear in `app/stt/` and nowhere else.
    """
    offenders: list[str] = []
    for path in APP_DIR.rglob("*.py"):
        if "__pycache__" in path.parts or path.parts[-2:-1] == ("stt",):
            continue
        source = path.read_text(encoding="utf-8")
        # Comments are prose about the design, not calls.
        code = "\n".join(
            line for line in source.splitlines() if not line.strip().startswith("#")
        )
        if re.search(r"\bfiles\s*=\s*\{", code):
            offenders.append(str(path.relative_to(APP_DIR)))

    assert not offenders, f"these send file uploads outside app/stt/: {offenders}"


def test_the_exercise_generator_never_receives_audio():
    """It is given the target sound, the stage and the language. Nothing else."""
    from app.journey import material
    from app.journey.stages import stage

    prompt = material._user_prompt("s", stage(3), None, "bn")

    assert "audio" not in prompt.lower()
    assert "recording" not in prompt.lower()
    # And structurally: generate() has no parameter that could carry one.
    import inspect

    params = set(inspect.signature(material.generate).parameters)
    assert not {"audio", "clip", "recording", "samples"} & params


# ── No personal information ──────────────────────────────────────────

#: Field names that would mean PhonoPlay had started collecting something it
#: has no use for. Checked against the wire schemas and the database, so a
#: field added later fails here rather than shipping.
PERSONAL_FIELDS = [
    "name", "first_name", "last_name", "full_name", "surname", "username",
    "email", "address", "postcode", "zip", "phone", "mobile", "telephone",
    "birth", "dob", "age", "gender", "sex", "ethnicity", "race", "religion",
    "nationality", "location", "latitude", "longitude", "ip_address",
    "device_id", "photo", "avatar", "school", "parent", "guardian",
    "diagnosis", "condition", "disability",
]


@pytest.mark.parametrize("model", [PronunciationResponse, TranscriptionResponse])
def test_no_response_schema_carries_personal_information(model):
    for field in model.model_fields:
        lowered = field.lower()
        assert not any(
            re.search(rf"(^|_){word}($|_)", lowered) for word in PERSONAL_FIELDS
        ), f"{model.__name__}.{field} looks like personal information"


def test_no_database_column_carries_personal_information(client):
    from app.journey.store import get_store

    store = get_store()
    # `sqlite_%` tables are SQLite's own bookkeeping — sqlite_sequence holds
    # table names in a column called `name`, which is not our data.
    tables = [
        row["name"]
        for row in store._db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
            " AND name NOT LIKE 'sqlite_%'"
        ).fetchall()
    ]
    assert tables, "the schema should have tables to check"
    for table in tables:
        for column in store._db.execute(f"PRAGMA table_info({table})").fetchall():
            lowered = column[1].lower()
            assert not any(
                re.search(rf"(^|_){word}($|_)", lowered) for word in PERSONAL_FIELDS
            ), f"{table}.{lowered} looks like personal information"


def test_the_learner_id_is_never_asked_for(client):
    """
    It is generated by the browser and used as an opaque key. Nothing in the
    API asks a learner to supply a meaningful one, and nothing derives
    anything from its contents.
    """
    response = client.get("/api/journey/an-arbitrary-opaque-string/profile")

    assert response.status_code == 200
    assert response.json()["learner_id"] == "an-arbitrary-opaque-string"


def test_pitch_is_not_reported(rag_wav, sank_wav):
    """
    f0 is computed upstream because the segmenter needs per-frame voicing,
    but it is not used by any reference profile and it is the most age- and
    sex-correlated number this stage can produce. It is deliberately absent
    from the response — see app/acoustic/features.py.

    Checked on an approximant, which is the only family that produces a
    speaker block at all: fricatives are scored without one, so /s/ reports
    nothing about the speaker whatsoever.
    """
    approximant = analyze(rag_wav, "r")

    assert approximant.speaker, "the speaker block should still carry what is used"
    assert not any("f0" in key or "pitch" in key.lower() for key in approximant.speaker)
    # Only the normalisation denominators remain.
    assert set(approximant.speaker) <= {"median_f1_hz", "median_f2_hz", "median_f3_hz"}

    assert analyze(sank_wav, "s").speaker == {}


def test_no_sensitive_characteristic_is_inferred(sank_wav):
    """
    The response describes a sound. It contains no field naming a speaker
    characteristic, and the formant medians it does carry are a normalisation
    denominator with no interpretation attached.
    """
    result = analyze(sank_wav, "s")
    payload = PronunciationResponse(**result.__dict__).model_dump()
    flat = str(payload).lower()

    # Whole words only. A substring check matches "age" inside "message" and
    # "sex" inside nothing useful, and a test that fails on its own wording
    # teaches people to weaken it.
    for word in ("gender", "sex", "age", "child", "adult", "accent", "ethnicity", "native"):
        assert not re.search(rf"{word}", flat), f"the response mentions {word!r}"


# ── Never a misleading number ────────────────────────────────────────


@pytest.mark.parametrize(
    "fixture", ["silence_wav", "white_noise_wav", "room_noise_wav", "clipped_wav", "tiny_wav"]
)
def test_a_failed_analysis_shows_the_promised_sentence_and_no_score(request, fixture):
    result = analyze(request.getfixturevalue(fixture), "s")

    assert result.message == safety.ANALYSIS_FAILED
    assert result.assessed is False
    assert result.estimated_match is None
    assert result.similarity_score == 0.0
    assert result.confidence == 0.0
    assert result.acoustic_features == {}


@pytest.mark.parametrize(
    "fixture", ["silence_wav", "white_noise_wav", "room_noise_wav", "clipped_wav"]
)
def test_the_failure_headline_never_varies(request, fixture):
    """
    Different causes, one headline. A headline that changed with the reason
    would let a failure read as a poor result; the cause is in `detail`.
    """
    result = analyze(request.getfixturevalue(fixture), "s")

    assert result.message == safety.ANALYSIS_FAILED
    assert result.detail, "the specific reason is still reported"
    assert result.detail != result.message


def test_low_confidence_says_exactly_what_was_promised(monkeypatch, sank_wav):
    monkeypatch.setattr("app.acoustic.scoring.CONFIDENCE_FLOOR", 1.01)
    result = analyze(sank_wav, "s")

    assert result.message == safety.UNCERTAIN
    assert result.estimated_match is None


# ── The standing disclosures ─────────────────────────────────────────


def test_the_disclaimer_is_exactly_the_promised_sentence():
    assert safety.DISCLAIMER == (
        "PhonoPlay provides educational pronunciation feedback and is not a "
        "medical diagnosis."
    )


def test_the_failure_message_is_exactly_the_promised_sentence():
    assert safety.ANALYSIS_FAILED == (
        "We couldn't confidently analyze this recording. Try again in a "
        "quieter environment."
    )


def test_the_uncertainty_message_is_exactly_the_promised_sentence():
    assert safety.UNCERTAIN == "Unable to confidently assess this attempt."


def test_the_safety_endpoint_serves_the_four_steps(client):
    body = client.get("/api/safety").json()

    assert body["disclaimer"] == safety.DISCLAIMER
    assert [step["step"] for step in body["how_it_works"]] == [1, 2, 3, 4]
    titles = [step["title"] for step in body["how_it_works"]]
    assert titles == [
        "Audio is analyzed",
        "Speech recognition provides linguistic context",
        "Acoustic features help estimate pronunciation similarity",
        "AI generates practice material",
    ]


def test_the_safety_endpoint_says_where_audio_goes(client):
    """
    Including the uncomfortable part: transcription sends the recording to a
    third party. A privacy notice that omitted that would be worse than none.
    """
    handling = {item["stage"]: item for item in client.get("/api/safety").json()["audio_handling"]}

    assert handling["acoustic"]["leaves_device"] is False
    assert handling["transcription"]["leaves_device"] is True
    assert "Groq" in handling["transcription"]["detail"]
    assert handling["material"]["leaves_device"] is False


def test_no_claim_of_clinical_accuracy():
    """The disclosures state limits; none of them overreaches."""
    text = " ".join(
        [safety.DISCLAIMER, safety.PRIVACY_SUMMARY, *safety.NOT_CLAIMED]
        + [step["detail"] for step in safety.HOW_IT_WORKS]
        + [item["detail"] for item in safety.AUDIO_HANDLING]
    ).lower()

    for phrase in ("clinically", "clinically validated", "accurate diagnosis", "medically"):
        assert phrase not in text
    # And the limits are stated, not implied.
    assert "does not diagnose" in " ".join(safety.NOT_CLAIMED).lower()
