"""HTTP bridge for the Next.js client.

Endpoints:
- GET  /api/health      -> {"status": "ok", "chat_model": ..., "embed_model": ...}
- POST /api/text        -> {"reply": "...", "thinking": "...", "audio": "...",
                             "client_directives": [...], "failed_calls": [...]}
                            (body: {"text": "..."})
- POST /api/voice       -> same response shape as /api/text
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

import re
import time
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
from tools import cactus_tools_json, dispatch
from tts import synth_wav_base64, synth_wav_bytes


# Matches Gemma's occasional plain-text tool-call format when it fails to
# emit the <|tool_call_start|>…<|tool_call_end|> tokens Cactus parses:
#   highlight_part(part="solar_arrays")
#   set_view(view="interior")
_PLAIN_TOOL_CALL_RE = re.compile(
    r"^\s*([a-z_][a-z0-9_]*)\s*\(([^)]*)\)\s*$",
    re.IGNORECASE,
)
_PLAIN_ARG_RE = re.compile(
    r"""([a-z_][a-z0-9_]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^,\s]+))""",
    re.IGNORECASE,
)


def _parse_inline_tool_call(text: str) -> dict[str, Any] | None:
    """If `text` is a standalone `name(key="val", ...)` expression — the shape
    Gemma produces when it skips the proper tool-call tokens — return a
    function_calls-style dict. Otherwise return None."""
    m = _PLAIN_TOOL_CALL_RE.match(text)
    if not m:
        return None
    name, arg_body = m.group(1), m.group(2)
    args: dict[str, Any] = {}
    for am in _PLAIN_ARG_RE.finditer(arg_body):
        key = am.group(1)
        value = am.group(2) if am.group(2) is not None else (
            am.group(3) if am.group(3) is not None else am.group(4)
        )
        args[key] = value
    return {"name": name, "arguments": args}


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
    turn_no = len([m for m in state.messages if m["role"] == "user"])
    t_turn_start = time.perf_counter()

    # Clear KV cache between voice turns. Cactus/Gemma-4 back-to-back
    # audio turns silently produce empty completions when prior-turn
    # audio tokens linger in cache. Empirically still true on the
    # a875fc3f source build (post-v1.14, PR #588 applied) — turn 2+
    # returned empty without this reset. The cost is a full re-prefill
    # of [system + tools] each turn (~20 s on M2 Air CPU) because smart
    # prompt caching can't kick in without the KV persisting across turns.
    # Will revisit when Cactus ships either a voice-turn cache fix or
    # the Gemma-4 LLM model.mlpackage (ANE-accelerated prefill).
    state.llm.reset()

    t_rag_start = time.perf_counter()
    msgs = messages_with_context(query_text)
    t_rag_end = time.perf_counter()

    # Intentional per-turn diagnostics — HAL runs headless; these lines
    # are the only way to see what Gemma did without attaching a debugger.
    print(
        f"[turn {turn_no}] query_text={query_text!r} pcm_bytes={len(pcm_data) if pcm_data else 0} "
        f"history_len={len(msgs)} roles={[m['role'] for m in msgs]}",
        flush=True,
    )

    t_llm_start = time.perf_counter()
    result = state.llm.complete(
        msgs,
        pcm_data=pcm_data,
        options=COMPLETION_OPTIONS,
        tools=cactus_tools_json(),
    )
    t_llm_end = time.perf_counter()

    response_text = (result.get("response", "") or "").strip()
    function_calls = result.get("function_calls") or []

    # Fallback: Gemma occasionally emits tool calls as plain text
    # (e.g. `highlight_part(part="solar_arrays")`) instead of the
    # <|tool_call_start|>…<|tool_call_end|> tokens Cactus parses. When
    # function_calls is empty and the cleaned response looks like a
    # single tool-call expression, synthesise the function_call entry
    # ourselves so dispatch still fires.
    if not function_calls and response_text:
        inline = _parse_inline_tool_call(response_text)
        if inline:
            function_calls = [inline]
            response_text = ""
            print(
                f"[turn {turn_no}] inline-tool-call recovered: {inline}",
                flush=True,
            )

    print(
        f"[turn {turn_no}] response={response_text!r} function_calls={function_calls}",
        flush=True,
    )

    dispatched = dispatch(function_calls)
    # Cactus sets cloud_handoff=true in the response JSON when its
    # internal auto_handoff swapped the local reply for a cloud reply
    # (cactus_complete.cpp:949). Surface it as a `source` field so the
    # client/log can tell which path answered.
    source = "cloud" if result.get("cloud_handoff") else "local"

    if function_calls:
        reply_text = dispatched.ack_text or "I am unable to comply with that request, Ethan."
    else:
        reply_text = response_text or "I am unable to comply with that request, Ethan."
    # Store the spoken line as the assistant turn. For tool-using turns we
    # store the ack rather than the raw <|tool_call_start|>...<|tool_call_end|>
    # tokens — storing the tokens without a following tool-result message left
    # a dangling exchange that confused Gemma on follow-up turns.
    state.messages.append({"role": "assistant", "content": reply_text})

    t_tts_start = time.perf_counter()
    audio_b64 = synth_wav_base64(reply_text)
    t_tts_end = time.perf_counter()

    def _ms(start: float, end: float) -> int:
        return int((end - start) * 1000)

    print(
        f"[turn {turn_no}] spoken={reply_text!r} failed={dispatched.failed_calls}",
        flush=True,
    )
    ttft_ms = getattr(state.llm, "last_ttft_ms", None)
    ttft_str = f"{int(ttft_ms)}ms" if ttft_ms is not None else "n/a"
    decode_ms = (
        int((t_llm_end - t_llm_start) * 1000 - ttft_ms)
        if ttft_ms is not None
        else None
    )
    decode_str = f"{decode_ms}ms" if decode_ms is not None else "n/a"
    print(
        f"[turn {turn_no}] timing rag={_ms(t_rag_start, t_rag_end)}ms "
        f"llm_total={_ms(t_llm_start, t_llm_end)}ms "
        f"ttft={ttft_str} decode={decode_str} "
        f"tts={_ms(t_tts_start, t_tts_end)}ms "
        f"source={source} "
        f"total={_ms(t_turn_start, t_tts_end)}ms",
        flush=True,
    )

    return {
        "reply": reply_text,
        "audio": audio_b64,
        "client_directives": dispatched.client_directives,
        "failed_calls": dispatched.failed_calls,
        "source": source,
    }


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
