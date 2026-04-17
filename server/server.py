"""HTTP bridge for the Next.js client.

Endpoints:
- GET  /api/health      -> {"status": "ok", "model": LLM_MODEL}
- POST /api/text        -> {"reply": "...", "thinking": "..."}     (body: {"text": "..."})
- POST /api/voice       -> {"reply": "...", "thinking": "..."}     (body: raw int16 LE
                                                                    16 kHz mono PCM)
- POST /api/reset       -> {"ok": true}                            (clears conversation)

Gemma 4 E2B is loaded once at startup. Conversation state is process-local
(single-user). Run with:

    server/.venv/bin/python -m uvicorn server:app --host 0.0.0.0 --port 8000
"""

import json
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from cactus_runtime import CactusSession
from config import COMPLETION_OPTIONS, LLM_MODEL, SYSTEM_PROMPT
from tools import TOOL_SCHEMAS, dispatch
from tts import synth_wav_base64


class AppState:
    llm: CactusSession | None = None
    messages: list[dict[str, Any]] = []


state = AppState()


def reset_conversation() -> None:
    state.messages = [{"role": "system", "content": SYSTEM_PROMPT}]


def run_turn(pcm_data: bytes | None = None) -> dict[str, Any]:
    assert state.llm is not None
    result = state.llm.complete(
        state.messages,
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
            state.messages, tools=TOOL_SCHEMAS, options=COMPLETION_OPTIONS
        )
        reply = follow_up.get("response", reply) or reply
        thinking = follow_up.get("thinking", thinking) or thinking

    state.messages.append({"role": "assistant", "content": reply})
    return {"reply": reply, "thinking": thinking, "audio": synth_wav_base64(reply)}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    print(f"Loading {LLM_MODEL}...", flush=True)
    state.llm = CactusSession(LLM_MODEL)
    reset_conversation()
    print("Model ready.", flush=True)
    yield
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
    return {"status": "ok", "model": LLM_MODEL, "turn_count": len(state.messages) - 1}


class TextIn(BaseModel):
    text: str


@app.post("/api/text")
def text(body: TextIn):
    state.messages.append({"role": "user", "content": body.text})
    return run_turn()


@app.post("/api/voice")
async def voice(request: Request):
    pcm = await request.body()
    state.messages.append({"role": "user", "content": ""})
    return run_turn(pcm_data=pcm)


@app.post("/api/reset")
def reset():
    reset_conversation()
    return {"ok": True}
