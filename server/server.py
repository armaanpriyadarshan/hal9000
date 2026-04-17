"""HTTP bridge for the Next.js client.

Endpoints:
- GET  /api/health      -> {"status": "ok", "model": LLM_MODEL}
- POST /api/text        -> {"reply": "...", "thinking": "..."}     (body: {"text": "..."})
- POST /api/voice       -> {"reply": "...", "thinking": "..."}     (body: raw int16 LE
                                                                    16 kHz mono PCM)
- POST /api/reset       -> {"ok": true}                            (clears conversation)

Gemma 4 E2B is loaded once at startup for chat. A second model
(Qwen3-Embedding-0.6B) owns the RAG index — its embedding space is
purpose-built for retrieval and performs far better than using
Gemma's own embeddings. A third model (Parakeet) transcribes the
mic so voice turns can also hit RAG. Retrieved chunks are injected
into Gemma's system prompt each turn without polluting the stored
conversation.

Run with:

    server/.venv/bin/python -m uvicorn server:app --host 0.0.0.0 --port 8000
"""

import json
from contextlib import asynccontextmanager
from copy import deepcopy
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from cactus_runtime import CactusSession, Transcriber
from config import (
    COMPLETION_OPTIONS,
    CORPUS_DIR,
    EMBED_MODEL,
    LLM_MODEL,
    STT_MODEL,
    SYSTEM_PROMPT,
)
from rag import EmbedRagIndex, build_context_block
from tools import TOOL_SCHEMAS, dispatch
from tts import synth_wav_base64, synth_wav_bytes


class AppState:
    llm: CactusSession | None = None
    rag: EmbedRagIndex | None = None
    stt: Transcriber | None = None
    messages: list[dict[str, Any]] = []


state = AppState()


def reset_conversation() -> None:
    state.messages = [{"role": "system", "content": SYSTEM_PROMPT}]


def messages_with_context(query_text: str) -> list[dict[str, Any]]:
    """Return a copy of state.messages with the latest RAG context
    injected into the system message. The stored conversation stays
    clean so next turn gets fresh retrieval."""
    msgs = deepcopy(state.messages)
    if not state.rag or not query_text.strip():
        return msgs
    chunks = state.rag.query(query_text, top_k=3)
    ctx = build_context_block(chunks)
    if not ctx:
        return msgs
    if msgs and msgs[0].get("role") == "system":
        msgs[0] = {**msgs[0], "content": ctx + msgs[0]["content"]}
    else:
        msgs.insert(0, {"role": "system", "content": ctx + SYSTEM_PROMPT})
    return msgs


def run_turn(query_text: str, pcm_data: bytes | None = None) -> dict[str, Any]:
    assert state.llm is not None
    prompt_messages = messages_with_context(query_text)

    result = state.llm.complete(
        prompt_messages,
        tools=TOOL_SCHEMAS,
        pcm_data=pcm_data,
        options=COMPLETION_OPTIONS,
    )
    reply = result.get("response", "") or ""
    thinking = result.get("thinking", "") or ""

    for call in result.get("function_calls") or []:
        name = call.get("name") or call.get("function", {}).get("name")
        args_raw = call.get("arguments", "{}")
        args = json.loads(args_raw) if isinstance(args_raw, str) else args_raw
        tool_output = dispatch(name, args)
        state.messages.append({"role": "assistant", "content": reply, "tool_calls": [call]})
        state.messages.append(
            {"role": "tool", "content": json.dumps({"name": name, "content": tool_output})}
        )
        follow_up = state.llm.complete(
            messages_with_context(query_text),
            tools=TOOL_SCHEMAS,
            options=COMPLETION_OPTIONS,
        )
        reply = follow_up.get("response", reply) or reply
        thinking = follow_up.get("thinking", thinking) or thinking

    state.messages.append({"role": "assistant", "content": reply})
    return {"reply": reply, "thinking": thinking, "audio": synth_wav_base64(reply)}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    print(f"Loading chat model {LLM_MODEL}...", flush=True)
    state.llm = CactusSession(LLM_MODEL)
    print(f"Loading embed model {EMBED_MODEL} with corpus {CORPUS_DIR}...", flush=True)
    state.rag = EmbedRagIndex(EMBED_MODEL, CORPUS_DIR, cache_index=True)
    print(f"Loading STT model {STT_MODEL}...", flush=True)
    state.stt = Transcriber(STT_MODEL)
    print("Warming HAL TTS (first call loads Qwen3-TTS into RAM)...", flush=True)
    synth_wav_bytes("Initialized.")
    reset_conversation()
    print("All models ready.", flush=True)
    yield
    if state.stt:
        state.stt.close()
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
        "stt_model": STT_MODEL,
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
    # Transcribe so we have a text handle on the user's utterance for RAG.
    # The raw PCM still goes to Gemma so its native audio understanding is preserved.
    transcript = state.stt.transcribe(pcm) if state.stt else ""
    state.messages.append({"role": "user", "content": transcript or ""})
    return run_turn(query_text=transcript, pcm_data=pcm)


@app.post("/api/reset")
def reset():
    reset_conversation()
    return {"ok": True}
