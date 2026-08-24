from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class Prompt:
    id: str
    text: str
    target_sound: str
    phonemes: tuple[str, ...]
    target_indices: tuple[int, ...]
    level: str = "word"
    difficulty: int = 1


SOUNDS = [
    {"id": "s", "ipa": "s", "label": "The S sound", "description": "A long, thin stream of air over the tip of the tongue."},
    {"id": "r", "ipa": "ɹ", "label": "The R sound", "description": "The tongue pulls back and bunches, lips stay relaxed."},
    {"id": "l", "ipa": "l", "label": "The L sound", "description": "Tongue tip touches the ridge behind the top teeth."},
    {"id": "th", "ipa": "θ", "label": "The TH sound", "description": "Tongue peeks between the teeth with a soft, quiet air flow."},
]


def _prompt(sound: str, word: str, phonemes: tuple[str, ...], index: int) -> Prompt:
    return Prompt(f"{sound}_word_{word}", word, sound, phonemes, (index,))


PROMPTS = [
    _prompt("s", "sun", ("s", "ʌ", "n"), 0), _prompt("s", "sock", ("s", "ɑ", "k"), 0),
    _prompt("s", "bus", ("b", "ʌ", "s"), 2), _prompt("s", "grass", ("g", "ɹ", "æ", "s"), 3),
    _prompt("r", "rabbit", ("ɹ", "æ", "b", "ɪ", "t"), 0), _prompt("r", "red", ("ɹ", "ɛ", "d"), 0),
    _prompt("r", "car", ("k", "ɑ", "ɹ"), 2), _prompt("r", "story", ("s", "t", "ɔ", "ɹ", "i"), 3),
    _prompt("l", "lion", ("l", "aɪ", "ə", "n"), 0), _prompt("l", "leaf", ("l", "i", "f"), 0),
    _prompt("l", "ball", ("b", "ɔ", "l"), 2), _prompt("l", "yellow", ("j", "ɛ", "l", "oʊ"), 2),
    _prompt("th", "thumb", ("θ", "ʌ", "m"), 0), _prompt("th", "think", ("θ", "ɪ", "ŋ", "k"), 0),
    _prompt("th", "bath", ("b", "æ", "θ"), 2), _prompt("th", "three", ("θ", "ɹ", "i"), 0),
]


def prompt_dict(prompt: Prompt) -> dict[str, object]:
    return asdict(prompt) | {"phonemes": list(prompt.phonemes), "target_indices": list(prompt.target_indices)}