"""Thin wrapper around the Cactus Python FFI for Gemma 4 audio-in chat."""

import json
import re
from pathlib import Path
from typing import Any, Callable, Iterable

from cactus import cactus_complete, cactus_destroy, cactus_init, cactus_reset

from config import WEIGHTS_ROOT


# Cactus' Gemma 4 output serialises tool-call arguments with UNQUOTED string
# values when Gemma emits them in the free-text token format, e.g.:
#     "arguments":{"part":solar_arrays}
# which is not valid JSON. We repair the string before json.loads by wrapping
# bareword identifiers that appear as object values in quotes. We leave the
# JSON literals (true/false/null) and numerics alone.
_BAREWORD_VALUE_RE = re.compile(
    r':\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?=[,}])'
)
_JSON_LITERALS = {"true", "false", "null"}


def _repair_cactus_json(raw: str) -> str:
    def replace(m: re.Match[str]) -> str:
        word = m.group(1)
        if word in _JSON_LITERALS:
            return m.group(0)
        # Preserve any trailing whitespace that was part of the match.
        return f':"{word}"'

    return _BAREWORD_VALUE_RE.sub(replace, raw)


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
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            pass
        # Cactus' Gemma 4 output leaves tool-call string arguments
        # unquoted — e.g. {"part":solar_arrays}. Repair and retry once.
        repaired = _repair_cactus_json(raw)
        try:
            parsed = json.loads(repaired)
            print(
                "[cactus_runtime] repaired unquoted-bareword JSON response",
                flush=True,
            )
            return parsed
        except json.JSONDecodeError as e:
            print(
                f"[cactus_runtime] JSON parse failed even after repair at "
                f"char {e.pos}: {repaired[max(0, e.pos - 40) : e.pos + 40]!r}",
                flush=True,
            )
            return {
                "response": "",
                "thinking": "",
                "function_calls": [],
            }

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
