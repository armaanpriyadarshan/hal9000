"""Retrieval-augmented generation using a dedicated embedding model
(Qwen3-Embedding-0.6B) separate from the chat model (Gemma 4).

Cactus's auto-RAG ties the corpus index to whichever model handle was
initialized with corpus_dir. To decouple retrieval from generation we
open a second Cactus handle on the embedder, build/load the index
against its embedding space, and manually inject the top-k chunks into
the chat model's messages each turn.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from cactus import cactus_destroy, cactus_init, cactus_rag_query

from cactus_runtime import resolve_weights


# Cap injected chunk length. Qwen3 returns full source chunks; a few are
# large enough to crowd the system prompt.
_MAX_CHARS_PER_CHUNK = 1400


class EmbedRagIndex:
    """Owns the embedding-model Cactus handle and its corpus index."""

    def __init__(self, embed_model: str, corpus_dir: Path, cache_index: bool = True):
        self.weights = resolve_weights(embed_model)
        self.handle = cactus_init(str(self.weights), str(corpus_dir), cache_index)

    def query(self, text: str, top_k: int = 3) -> list[dict[str, Any]]:
        if not text.strip():
            return []
        raw = cactus_rag_query(self.handle, text, top_k)
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return []
        return parsed.get("chunks", []) or []

    def close(self) -> None:
        if self.handle:
            cactus_destroy(self.handle)
            self.handle = 0


def build_context_block(chunks: list[dict[str, Any]]) -> str:
    """Format retrieved chunks for injection into the system prompt.

    Qwen3 absolute scores stay low on this corpus; we intentionally do
    not filter on score and rely on top-k ranking instead.
    """
    usable = [c for c in chunks if c.get("content")]
    if not usable:
        return ""
    # Header matches Cactus's own auto-RAG wording (cactus_rag.cpp:183)
    # except we substitute HAL's "say so plainly rather than speculate"
    # phrasing from the system prompt for Cactus's default "I don't have
    # enough information" boilerplate, which is off-brand for the agent.
    parts = [
        "[Retrieved Context — Use ONLY this information to answer. "
        "If the answer is not in the context, say so plainly rather "
        "than speculate.]\n",
    ]
    for c in usable:
        source = c.get("source", "unknown")
        content = (c.get("content") or "").strip()
        if len(content) > _MAX_CHARS_PER_CHUNK:
            content = content[:_MAX_CHARS_PER_CHUNK].rstrip() + "…"
        parts.append(f"---\n{content}\n(Source: {source})")
    parts.append("---\n\n")
    return "\n".join(parts)
