"""HTTP bridge for the Next.js client.

Endpoints:
- GET  /api/health           -> {"status": "ok", "chat_model": ..., "embed_model": ...}
- POST /api/text             -> {"reply": "...", "thinking": "...", "audio": "...",
                                  "client_directives": [...], "failed_calls": [...]}
                                 (body: {"text": "..."})
- POST /api/voice            -> same response shape as /api/text
                                 (body: raw int16 LE 16 kHz mono PCM)
- POST /api/reset            -> {"ok": true}
- GET  /api/debug/telemetry  -> current ShipState as JSON
- POST /api/debug/inject     -> inject an anomaly: {"anomaly": "name", "params": {...}}
- POST /api/debug/clear      -> reset all anomaly parameters to nominal

Three local models back the server:
- Gemma 4 E2B for chat (audio-in handled natively, no separate STT).
- Qwen3-Embedding-0.6B for RAG retrieval against server/corpus/.
- Kokoro-82M (ONNX) for TTS; reply audio is returned as a base64 WAV.

A fourth subsystem, the telemetry simulator (telemetry.py), is owned by
the FastAPI lifespan and integrated forward-Euler at 1 Hz. Its current
state is prepended to the system prompt every turn so HAL always sees
live readings alongside RAG context.

Retrieved corpus chunks are injected into the system prompt per turn
without polluting the stored conversation.

Run:
    server/.venv/bin/python -m uvicorn server:app --host 0.0.0.0 --port 8000
"""

import asyncio
import re
import threading
import time
from contextlib import asynccontextmanager
from copy import deepcopy
from dataclasses import asdict
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from cactus_runtime import CactusSession

import anomalies as anomalies_lib
import cactus_proxy
import ora as ora_lib
import telemetry as telemetry_lib
from cactus_proxy import _transcribe_audio, apply_mishear_fixups
from config import (
    CLOUD_FIRST,
    COMPLETION_OPTIONS,
    CORPUS_DIR,
    DEBUG_TRANSCRIBE,
    EMBED_MODEL,
    LLM_MODEL,
    SYSTEM_PROMPT,
)
from observer import AlertEvent, Observer, event_to_dict
from ora import AlertBroadcaster, AlertPayload, payload_to_sse, process_event
from rag import EmbedRagIndex, build_context_block
from telemetry import ShipState, build_telemetry_block, run_loop
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
    ship: ShipState | None = None
    ship_task: asyncio.Task | None = None
    ship_stop: asyncio.Event | None = None
    # ORA loop state
    observer: Observer | None = None
    broadcaster: AlertBroadcaster | None = None
    ora_task: asyncio.Task | None = None
    ora_stop: asyncio.Event | None = None
    # Operator-controllable flag. When False the observer still scans
    # (cooldown state stays accurate) but events are dropped before
    # reaching the Reasoner.
    alerts_enabled: bool = True


state = AppState()


def _on_alert(payload: AlertPayload) -> None:
    """Actor callback — injects HAL's proactive line into conversation
    history so follow-up turns ('what's the procedure?') see context.

    Called from the ORA task thread; state.messages is mutated here.
    Safe because run_turn reads state.messages only at the top of a
    turn and we never mutate while it's reading."""
    state.messages.append({
        "role": "assistant",
        "content": payload.text,
    })
    print(
        f"[ora] injected assistant turn ({len(payload.text)} chars) "
        f"into history — total messages now {len(state.messages)}",
        flush=True,
    )


def reset_conversation() -> None:
    state.messages = [{"role": "system", "content": SYSTEM_PROMPT}]


def messages_with_context(query_text: str) -> list[dict[str, Any]]:
    """Copy of state.messages with telemetry + RAG context prepended to
    the system message for this turn only. State stays clean for the
    next turn. Order in the final system message (top-down):
        [Live Ship Telemetry]  — current ship state (every turn)
        [Retrieved Context]    — RAG chunks (when query_text non-empty)
        [HAL persona / rules]  — the baseline SYSTEM_PROMPT
    """
    msgs = deepcopy(state.messages)
    # RAG needs a non-empty query; voice turn 1 has none.
    if state.rag and query_text.strip():
        chunks = state.rag.query(query_text, top_k=3)
        ctx = build_context_block(chunks)
        if ctx:
            msgs[0] = {**msgs[0], "content": ctx + msgs[0]["content"]}
    # Telemetry injects unconditionally — HAL should know ship state
    # even on voice turn 1 where there's no query to RAG against.
    if state.ship is not None:
        tele = build_telemetry_block(state.ship)
        msgs[0] = {**msgs[0], "content": tele + msgs[0]["content"]}
    return msgs


def run_turn(query_text: str, pcm_data: bytes | None = None) -> dict[str, Any]:
    assert state.llm is not None
    turn_no = len([m for m in state.messages if m["role"] == "user"])
    t_turn_start = time.perf_counter()

    # Voice turns send the raw PCM straight to /omni — flash-preview's
    # native audio encoder handles ASR + reasoning in one pass and is
    # more accurate on domain proper nouns than Cactus's standalone
    # /transcribe endpoint. If DEBUG_TRANSCRIBE is on, we ALSO fire a
    # /transcribe call in a background thread purely for the log line
    # (never feeds into RAG or the prompt). Set DEBUG_TRANSCRIBE=false
    # in server/.env to kill the extra round-trip for demo/prod.
    if pcm_data is not None and DEBUG_TRANSCRIBE:
        def _log_transcript(pcm: bytes, turn: int) -> None:
            t0 = time.perf_counter()
            transcript = _transcribe_audio(pcm)
            dt_ms = int((time.perf_counter() - t0) * 1000)
            if transcript:
                corrected = apply_mishear_fixups(transcript)
                if corrected != transcript:
                    print(
                        f"[turn {turn}] debug_transcript={transcript!r} -> {corrected!r} (mishear fixup) ({dt_ms}ms)",
                        flush=True,
                    )
                else:
                    print(
                        f"[turn {turn}] debug_transcript={transcript!r} ({dt_ms}ms)",
                        flush=True,
                    )
            else:
                print(
                    f"[turn {turn}] debug_transcript failed ({dt_ms}ms)",
                    flush=True,
                )

        threading.Thread(
            target=_log_transcript, args=(pcm_data, turn_no), daemon=True
        ).start()

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

    # Cloud-first routing: when CLOUD_FIRST is on we hit the Cactus
    # proxy first and only invoke the local model if that call fails
    # (timeout / network / http error). This differs from Cactus's own
    # auto_handoff, which always runs both in parallel. Cloud-first is
    # cheaper when network is up; falls back cleanly when it isn't.
    source = "local"
    response_text = ""
    function_calls: list = []
    cloud_error: str | None = None
    t_llm_start = time.perf_counter()
    ttft_ms: float | None = None

    if CLOUD_FIRST:
        cloud = cactus_proxy.complete(
            msgs,
            tools=cactus_tools_json(),
            pcm_data=pcm_data,
        )
        if cloud["ok"]:
            response_text = cloud["response"]
            function_calls = cloud["function_calls"]
            source = "cloud"
        else:
            cloud_error = cloud["error"]
            print(
                f"[turn {turn_no}] cloud failed ({cloud_error}); falling back to local",
                flush=True,
            )

    if not CLOUD_FIRST or cloud_error is not None:
        # Clear KV cache before every local call. Cactus's Gemma-4
        # audio-decode path (model_gemma4_mm.cpp:decode_multimodal)
        # silently returns empty on back-to-back voice turns when
        # prior-turn audio tokens linger in the cache. Reset is also
        # safest in CLOUD_FIRST fallbacks since the cache may hold
        # partial state from an earlier successful cloud turn that
        # never flushed it (we don't inject assistant replies back
        # into the local KV).
        state.llm.reset()
        result = state.llm.complete(
            msgs,
            pcm_data=pcm_data,
            options=COMPLETION_OPTIONS,
            tools=cactus_tools_json(),
        )
        response_text = (result.get("response", "") or "").strip()
        function_calls = result.get("function_calls") or []
        # If Cactus's native auto_handoff was enabled and picked cloud,
        # surface that. Harmless no-op when auto_handoff is False.
        if result.get("cloud_handoff"):
            source = "cloud"
        ttft_ms = getattr(state.llm, "last_ttft_ms", None)

    t_llm_end = time.perf_counter()

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
    # ttft_ms only exists when the local path ran (cactus_runtime fills
    # it via the token callback). Cloud-first turns that succeed have no
    # ttft — they're one blocking HTTP round-trip, no streaming.
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
    # Spin up the telemetry simulator. 1 Hz is enough for the ECLSS/TCS/
    # EPS/GN&C timescales we care about and keeps the log volume sane.
    state.ship = ShipState.nominal()
    state.ship_stop = asyncio.Event()
    state.ship_task = asyncio.create_task(
        run_loop(state.ship, state.ship_stop, tick_hz=1.0)
    )
    # Let the tools registry mutate the ship via server-tool handlers
    # (see tools.py _execute_procedure_handler). Also wire the alert
    # broadcaster so procedures can emit a resolution payload.
    import tools as tools_module
    tools_module.set_ship_state(state.ship)
    print("Telemetry simulator running at 1 Hz.", flush=True)

    # Spin up the ORA (Observer-Reasoner-Actor) loop. Scans sim state
    # each tick, gates non-emergency events through the cloud LLM, and
    # broadcasts to SSE subscribers.
    state.observer = Observer(cooldown_s=60.0)
    state.broadcaster = AlertBroadcaster()
    state.ora_stop = asyncio.Event()
    state.ora_task = asyncio.create_task(
        ora_lib.ora_loop(
            state_getter=lambda: state.ship,
            observer=state.observer,
            broadcaster=state.broadcaster,
            on_alert=_on_alert,
            stop_event=state.ora_stop,
            poll_hz=1.0,
            enabled_getter=lambda: state.alerts_enabled,
        )
    )
    # Let server-tool handlers (execute_procedure) emit resolution
    # broadcasts via the same broadcaster so the UI drops out of
    # emergency mode when the crew closes out a procedure.
    tools_module.set_alert_broadcaster(state.broadcaster, _on_alert)
    print("ORA loop running (alerts enabled).", flush=True)
    print("All models ready.", flush=True)
    yield
    if state.ora_stop is not None:
        state.ora_stop.set()
    if state.ora_task is not None:
        try:
            await asyncio.wait_for(state.ora_task, timeout=2.0)
        except asyncio.TimeoutError:
            state.ora_task.cancel()
    if state.ship_stop is not None:
        state.ship_stop.set()
    if state.ship_task is not None:
        try:
            await asyncio.wait_for(state.ship_task, timeout=2.0)
        except asyncio.TimeoutError:
            state.ship_task.cancel()
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


# ---- debug / operator control plane --------------------------------
# Not gated behind auth. Fine for the demo — the server binds 0.0.0.0
# so an operator on the same network can curl these. If we ever ship
# this to something real, add a shared-secret header gate.


class InjectRequest(BaseModel):
    anomaly: str
    params: dict[str, Any] = {}


@app.get("/api/debug/telemetry")
def debug_telemetry():
    if state.ship is None:
        raise HTTPException(status_code=503, detail="sim not running")
    # asdict serialises dataclasses deeply — including the nested
    # ShipParams — into a plain JSON-safe dict.
    return asdict(state.ship)


@app.post("/api/debug/inject")
def debug_inject(body: InjectRequest):
    if state.ship is None:
        raise HTTPException(status_code=503, detail="sim not running")
    try:
        spec = anomalies_lib.inject(state.ship, body.anomaly, body.params)
    except KeyError:
        raise HTTPException(
            status_code=404,
            detail=f"unknown anomaly '{body.anomaly}'; "
                   f"known: {sorted(anomalies_lib.ANOMALIES)}",
        )
    print(
        f"[debug] injected anomaly {spec.name} "
        f"(severity={spec.severity}, module={spec.module}) params={body.params}",
        flush=True,
    )
    return {
        "ok": True,
        "anomaly": spec.name,
        "severity": spec.severity,
        "module": spec.module,
        "summary": spec.summary,
        "active_anomalies": list(state.ship.active_anomalies),
    }


@app.post("/api/debug/clear")
def debug_clear():
    if state.ship is None:
        raise HTTPException(status_code=503, detail="sim not running")
    previous = list(state.ship.active_anomalies)
    anomalies_lib.clear(state.ship)
    print(f"[debug] cleared anomalies: {previous}", flush=True)
    return {"ok": True, "cleared": previous}


# ---- ORA / proactive alerts control plane ------------------------


class FireAlertRequest(BaseModel):
    name: str
    severity: str = "caution"
    text: str | None = None
    module: str | None = None
    use_llm_gate: bool = False


@app.get("/api/alerts/stream")
async def alerts_stream():
    """SSE endpoint — subscribers receive every proactive alert as a
    JSON frame. Client-side:
        const es = new EventSource('/api/alerts/stream')
        es.onmessage = (e) => { const p = JSON.parse(e.data); ... }
    """
    if state.broadcaster is None:
        raise HTTPException(status_code=503, detail="ORA not running")
    broadcaster = state.broadcaster
    q = await broadcaster.subscribe()

    async def gen():
        try:
            # Initial comment so the client's EventSource knows the
            # connection is live; comments don't trigger `onmessage`.
            yield b": hal9000 alerts stream ready\n\n"
            while True:
                # wait_for with a 15 s cap so an idle stream still
                # emits a keepalive comment. Chromium has been
                # observed to treat long-idle SSE streams as broken
                # and tear down the EventSource; a periodic `: ka`
                # line keeps the connection hot without triggering
                # `onmessage` on the client.
                try:
                    payload = await asyncio.wait_for(q.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield b": ka\n\n"
                    continue
                yield payload_to_sse(payload)
        finally:
            await broadcaster.unsubscribe(q)

    # text/event-stream; disable proxy buffering for prompt delivery.
    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@app.post("/api/debug/fire_alert")
async def debug_fire_alert(body: FireAlertRequest):
    """Operator escape hatch — fire an alert directly without waiting
    for a threshold crossing. Defaults to speaking `text` verbatim
    (canned path). Set `use_llm_gate: true` to route through the
    Reasoner (e.g. to exercise the gate prompt end-to-end)."""
    if state.ship is None or state.broadcaster is None:
        raise HTTPException(status_code=503, detail="sim not running")
    event = AlertEvent(
        event_id=f"operator:{body.name}:{int(time.time())}",
        source="operator",
        name=body.name,
        severity=body.severity,
        summary=body.text or f"Operator alert: {body.name}",
        module=body.module,
        # canned_text drives the bypass path. If the operator wants the
        # LLM gate to run, null it out so process_event gates instead.
        canned_text=body.text if not body.use_llm_gate else None,
        snapshot={"operator_forced": True},
        timestamp=time.time(),
    )
    payload = await process_event(
        event,
        state.broadcaster,
        _on_alert,
        use_llm_gate=body.use_llm_gate,
    )
    return {
        "ok": True,
        "fired": payload is not None,
        "subscriber_count": state.broadcaster.subscriber_count(),
        "payload": None if payload is None else {
            "event_id": payload.event_id,
            "name": payload.name,
            "severity": payload.severity,
            "module": payload.module,
            "text": payload.text,
            "gate": payload.gate,
            # intentionally omitting audio_b64 here — operators can
            # verify the text; the audio bytes are large and not useful
            # in a JSON response to curl.
        },
    }


@app.post("/api/debug/alerts/pause")
def debug_alerts_pause():
    """Stop processing alerts. Observer keeps scanning (cooldown
    state stays accurate) but events don't reach the Reasoner.
    Useful mid-demo to silence HAL without stopping the sim."""
    state.alerts_enabled = False
    return {"ok": True, "alerts_enabled": False}


@app.post("/api/debug/alerts/enable")
def debug_alerts_enable():
    state.alerts_enabled = True
    return {"ok": True, "alerts_enabled": True}


@app.post("/api/debug/alerts/reset_cooldowns")
def debug_alerts_reset_cooldowns():
    """Clear per-event-id cooldown state so the next observer scan
    can re-fire already-seen events. Useful when rehearsing a
    sequence more than once inside a single demo window."""
    if state.observer is None:
        raise HTTPException(status_code=503, detail="ORA not running")
    state.observer.reset_cooldowns()
    return {"ok": True}


@app.post("/api/debug/full_reset")
def debug_full_reset():
    """Wipe everything back to a clean slate — physics sim back to
    nominal, no anomalies active, observer cooldowns cleared,
    conversation history wiped, alerts re-enabled.

    Called automatically by the audience-page useEffect on hard
    refresh so the operator never inherits leftover state from a
    previous session. Also available on /ops as a Reset All button.
    """
    if state.ship is not None:
        state.ship.reset_to_nominal()
    if state.observer is not None:
        state.observer.reset_cooldowns()
    state.alerts_enabled = True
    reset_conversation()
    print("[debug] full reset — sim nominal, history wiped", flush=True)
    return {"ok": True}
