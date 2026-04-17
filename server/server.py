"""HTTP bridge for the Next.js client.

Endpoints:
- GET  /api/health      -> {"status": "ok", "chat_model": ..., "embed_model": ...}
- POST /api/text        -> {"reply": "...", "thinking": "...", "audio": "..."}
                            (body: {"text": "..."})
- POST /api/voice       -> {"reply": "...", "thinking": "...", "audio": "..."}
                            (body: raw int16 LE 16 kHz mono PCM)
- POST /api/reset       -> {"ok": true}

Three local models back the server:
- Gemma 4 E2B for chat (audio-in handled natively, no separate STT).
- Qwen3-Embedding-0.6B for RAG retrieval against server/corpus/.
- Kokoro-82M (ONNX) for TTS; reply audio is returned as a base64 WAV.

Retrieved corpus chunks are injected into the system prompt per turn
without polluting the stored conversation.

Run:
    server/.venv/bin/python -m uvicorn server:app --host 0.0.0.0 --port 8000
"""

from contextlib import asynccontextmanager
from copy import deepcopy
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from cactus_runtime import CactusSession
from config import (
    COMPLETION_OPTIONS,
    CORPUS_DIR,
    EMBED_MODEL,
    LLM_MODEL,
    SYSTEM_PROMPT,
)
from rag import EmbedRagIndex, build_context_block
from tts import synth_wav_base64, synth_wav_bytes


class AppState:
    llm: CactusSession | None = None
    rag: EmbedRagIndex | None = None
    messages: list[dict[str, Any]] = []


state = AppState()


def reset_conversation() -> None:
    state.messages = [{"role": "system", "content": SYSTEM_PROMPT}]


def messages_with_context(query_text: str) -> list[dict[str, Any]]:
    """Copy of state.messages with RAG context prepended to the system
    message for this turn only. State stays clean for next turn."""
    msgs = deepcopy(state.messages)
    if not state.rag or not query_text.strip():
        return msgs
    chunks = state.rag.query(query_text, top_k=3)
    ctx = build_context_block(chunks)
    if not ctx:
        return msgs
    msgs[0] = {**msgs[0], "content": ctx + msgs[0]["content"]}
    return msgs


def run_turn(query_text: str, pcm_data: bytes | None = None) -> dict[str, Any]:
    assert state.llm is not None
    result = state.llm.complete(
        messages_with_context(query_text),
        pcm_data=pcm_data,
        options=COMPLETION_OPTIONS,
    )
    reply = result.get("response", "") or ""
    thinking = result.get("thinking", "") or ""
    state.messages.append({"role": "assistant", "content": reply})
    return {"reply": reply, "thinking": thinking, "audio": synth_wav_base64(reply)}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    print(f"Loading chat model {LLM_MODEL}...", flush=True)
    state.llm = CactusSession(LLM_MODEL)
    print(f"Loading embed model {EMBED_MODEL} with corpus {CORPUS_DIR}...", flush=True)
    state.rag = EmbedRagIndex(EMBED_MODEL, CORPUS_DIR, cache_index=True)
    print("Warming HAL TTS...", flush=True)
    synth_wav_bytes("Initialized.")
    reset_conversation()
    print("All models ready.", flush=True)
    yield
    if state.rag:
        state.rag.close()
    if state.llm:
        state.llm.close()


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r".*",
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "chat_model": LLM_MODEL,
        "embed_model": EMBED_MODEL,
        "turn_count": max(0, len(state.messages) - 1),
    }


class TextIn(BaseModel):
    text: str


@app.post("/api/text")
def text(body: TextIn):
    state.messages.append({"role": "user", "content": body.text})
    return run_turn(query_text=body.text)


@app.post("/api/voice")
async def voice(request: Request):
    pcm = await request.body()
    state.messages.append({"role": "user", "content": ""})
    # On voice turns we don't have a text query for RAG; use the previous
    # assistant reply as a topical hint so follow-ups still retrieve
    # relevant chunks. Empty on the first turn.
    last_text = ""
    for m in reversed(state.messages[:-1]):
        if m.get("role") == "assistant" and isinstance(m.get("content"), str):
            last_text = m["content"]
            break
    return run_turn(query_text=last_text, pcm_data=pcm)


@app.post("/api/reset")
def reset():
    reset_conversation()
    return {"ok": True}
