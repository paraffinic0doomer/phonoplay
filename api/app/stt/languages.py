"""
Language-name normalization, shared by every provider.

Whisper reports languages by English name ("English"), not by code. Callers
want something stable to branch on, so `Transcription` derives an ISO-639-1
`language_code` from whatever the provider said. Keeping this here rather than
inside a provider means a second backend gets the same behaviour for free.
"""

from __future__ import annotations

#: Deliberately a partial map. An unrecognised language yields None rather
#: than a guess — a wrong code is worse than an absent one.
LANGUAGE_CODES: dict[str, str] = {
    "english": "en", "spanish": "es", "french": "fr", "german": "de",
    "italian": "it", "portuguese": "pt", "dutch": "nl", "polish": "pl",
    "russian": "ru", "ukrainian": "uk", "turkish": "tr", "arabic": "ar",
    "hindi": "hi", "urdu": "ur", "bengali": "bn", "tamil": "ta",
    "telugu": "te", "marathi": "mr", "gujarati": "gu", "punjabi": "pa",
    "chinese": "zh", "mandarin": "zh", "cantonese": "yue", "japanese": "ja",
    "korean": "ko", "vietnamese": "vi", "thai": "th", "indonesian": "id",
    "malay": "ms", "filipino": "tl", "tagalog": "tl", "swedish": "sv",
    "norwegian": "no", "danish": "da", "finnish": "fi", "icelandic": "is",
    "greek": "el", "hebrew": "he", "czech": "cs", "slovak": "sk",
    "romanian": "ro", "hungarian": "hu", "bulgarian": "bg", "croatian": "hr",
    "serbian": "sr", "catalan": "ca", "persian": "fa", "swahili": "sw",
}


def to_iso_639_1(language: str | None) -> str | None:
    """
    "English" -> "en". A two-letter code passes through unchanged.
    Anything unrecognised -> None.
    """
    if not language:
        return None
    value = language.strip().lower()
    if len(value) == 2 and value.isalpha():
        return value
    return LANGUAGE_CODES.get(value)
