from pathlib import Path

from app.config import Settings


def test_groq_key_pool_reads_file_without_duplicates(tmp_path: Path):
    key_file = tmp_path / "groq.txt"
    key_file.write_text("key-a\n\nkey-b\nkey-a\n", encoding="utf-8")

    settings = Settings(stt_provider="groq", groq_keys_file=str(key_file))

    assert settings.groq_api_key_pool == ["key-a", "key-b"]