"""Thin wrapper around the Cactus Python FFI for Gemma 4 audio-in chat."""

import json
from pathlib import Path
from typing import Any, Callable, Iterable

from cactus import (
    cactus_complete,
    cactus_destroy,
    cactus_init,
    cactus_reset,
    cactus_transcribe,
)

from config import WEIGHTS_ROOT


def resolve_weights(model_name: str) -> Path:
    short = model_name.split("/")[-1].lower()
    for candidate in (WEIGHTS_ROOT / short, WEIGHTS_ROOT / model_name):
        if candidate.exists() and any(candidate.iterdir()):
            return candidate
    raise FileNotFoundError(
        f"Weights for {model_name} not found under {WEIGHTS_ROOT}. "
        f"Run: cactus download {model_name}"
    )


class CactusSession:
    """Long-lived Gemma 4 session. KV cache persists across turns.

    If `corpus_dir` points at a directory of txt/md files, Cactus builds
    (or loads, with cache_index=True) a retrieval index; relevant chunks
    are auto-injected into every completion.
    """

    def __init__(
        self,
        model_name: str,
        corpus_dir: Path | None = None,
        cache_index: bool = True,
    ):
        self.weights = resolve_weights(model_name)
        corpus_arg = str(corpus_dir) if corpus_dir else None
        self.handle = cactus_init(str(self.weights), corpus_arg, cache_index)

    def complete(
        self,
        messages: Iterable[dict[str, Any]],
        *,
        options: dict[str, Any] | None = None,
        tools: list[dict[str, Any]] | None = None,
        pcm_data: bytes | None = None,
        on_token: Callable[[str, int], None] | None = None,
    ) -> dict[str, Any]:
        raw = cactus_complete(
            self.handle,
            json.dumps(list(messages)),
            json.dumps(options) if options else None,
            json.dumps(tools) if tools else None,
            on_token,
            pcm_data,
        )
        return json.loads(raw)

    def reset(self) -> None:
        cactus_reset(self.handle)

    def close(self) -> None:
        if self.handle:
            cactus_destroy(self.handle)
            self.handle = 0

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


class Transcriber:
    """Loads a transcription model (Parakeet/Whisper) once and transcribes
    raw PCM buffers to text. Used to get a text handle on the user's
    utterance so we can query RAG with it."""

    def __init__(self, model_name: str):
        self.weights = resolve_weights(model_name)
        self.handle = cactus_init(str(self.weights), None, False)

    def transcribe(self, pcm_data: bytes) -> str:
        if not pcm_data:
            return ""
        raw = cactus_transcribe(self.handle, None, None, None, None, pcm_data)
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return ""
        segments = parsed.get("segments") or []
        text = " ".join(
            s.get("text", "") for s in segments if isinstance(s, dict) and s.get("text")
        )
        return text.strip()

    def close(self) -> None:
        if self.handle:
            cactus_destroy(self.handle)
            self.handle = 0

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
