"""Thin wrapper around the Cactus Python FFI for chat completion."""

import json
from typing import Any, Callable, Iterable

from cactus import cactus_complete, cactus_destroy, cactus_init, cactus_reset


class CactusSession:
    def __init__(self, weights_path: str):
        self.handle = cactus_init(weights_path, None, False)

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
