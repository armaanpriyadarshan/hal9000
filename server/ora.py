"""Reasoner + Actor tiers of the ORA (Observer-Reasoner-Actor) loop.

Reasoner: for advisory/caution events (and warnings without canned_text),
calls the cloud LLM with a structured ALERT/SILENT gate. Emergency
events with canned_text bypass the gate — hull breach is not the
moment to round-trip to Gemini.

Actor: synthesises TTS, broadcasts the payload to all connected SSE
subscribers, and invokes a caller-supplied `on_alert` callback (the
server uses this to inject a synthetic assistant turn into conversation
history so follow-ups like "what procedure?" work naturally).

The cloud-proxy / Piper TTS calls are both blocking (httpx.Client +
onnxruntime); we wrap them in asyncio.to_thread so the 1-Hz ORA loop
doesn't stall while the gate is thinking.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from dataclasses import dataclass, asdict
from typing import Any, Callable

import cactus_proxy
from observer import AlertEvent, Observer
from telemetry import ShipState
from tts import synth_wav_base64


# Gate prompt. Kept deliberately short — this runs many times per
# demo and every token is TTFT. The structured ALERT/SILENT contract
# lets us parse with a regex rather than trusting free-form prose.
_GATE_SYSTEM = (
    "You are a gating function deciding whether HAL 9000 (the onboard "
    "AI) should interrupt the crew to announce an anomaly. You reply "
    "with exactly one of these two shapes, nothing else:\n"
    "\n"
    "  ALERT: <one to two sentences HAL will speak to the crew>\n"
    "  SILENT: <brief reason to skip>\n"
    "\n"
    "Decision rules:\n"
    "  1. ALERT only if the situation needs crew attention within "
    "the next few minutes.\n"
    "  2. If the condition could be safely ignored for 30+ minutes "
    "with no cascade risk, choose SILENT.\n"
    "  3. ALERT lines are in HAL's voice: calm, precise, address "
    "the crew by name where appropriate (Commander Armaan, Flight "
    "Engineer Ethan, Flight Engineer Samarjit). Lead with one "
    "specific fact and one recommended action.\n"
    "  4. Do not speculate beyond the anomaly summary and the "
    "provided ship state.\n"
    "  5. Never include markdown or code fences. Never emit tool "
    "calls.\n"
)


# Structured-output parser. Non-greedy inner match; anchor at line
# start so a misformatted 'SILENT' inside an ALERT line doesn't win.
_ALERT_RE = re.compile(r"(?:^|\n)\s*ALERT\s*:\s*(.+?)(?:\n\s*$|\Z)",
                       re.IGNORECASE | re.DOTALL)
_SILENT_RE = re.compile(r"(?:^|\n)\s*SILENT\s*:", re.IGNORECASE)


@dataclass
class AlertPayload:
    """Shape delivered to SSE subscribers and written to conversation
    history. `audio_b64` is a full base64 WAV, playable directly in
    the browser via AudioContext.decodeAudioData."""

    event_id: str
    name: str
    severity: str
    module: str | None
    text: str             # what HAL will say
    audio_b64: str
    source: str           # "anomaly" | "threshold"
    timestamp: float
    gate: str             # "canned" | "llm"


class AlertBroadcaster:
    """Fan-out channel for SSE subscribers. Each subscriber is an
    asyncio.Queue; broadcast pushes a copy to every queue.

    Queues are bounded (maxsize=16) — if a subscriber falls behind, we
    drop the oldest payload to make room rather than block the
    broadcaster (slow-consumer quarantine)."""

    def __init__(self, per_sub_capacity: int = 16):
        self._subscribers: list[asyncio.Queue[AlertPayload]] = []
        self._lock = asyncio.Lock()
        self._cap = per_sub_capacity

    async def subscribe(self) -> asyncio.Queue[AlertPayload]:
        q: asyncio.Queue[AlertPayload] = asyncio.Queue(maxsize=self._cap)
        async with self._lock:
            self._subscribers.append(q)
        return q

    async def unsubscribe(self, q: asyncio.Queue[AlertPayload]) -> None:
        async with self._lock:
            if q in self._subscribers:
                self._subscribers.remove(q)

    async def broadcast(self, payload: AlertPayload) -> None:
        async with self._lock:
            targets = list(self._subscribers)
        for q in targets:
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                # Drop oldest then retry; if it still fails, skip.
                try:
                    q.get_nowait()
                except asyncio.QueueEmpty:
                    pass
                try:
                    q.put_nowait(payload)
                except asyncio.QueueFull:
                    pass

    def subscriber_count(self) -> int:
        return len(self._subscribers)


def _build_gate_messages(event: AlertEvent) -> list[dict[str, Any]]:
    snap_lines = []
    for k, v in event.snapshot.items():
        if isinstance(v, float):
            snap_lines.append(f"  {k} = {v:.3f}")
        else:
            snap_lines.append(f"  {k} = {v}")
    user = (
        f"Anomaly: {event.name} (severity: {event.severity}, "
        f"source: {event.source})\n"
        f"Summary: {event.summary}\n"
        f"Relevant state at detection:\n"
        + "\n".join(snap_lines)
        + "\n\nReply with ALERT or SILENT per the system instructions."
    )
    return [
        {"role": "system", "content": _GATE_SYSTEM},
        {"role": "user", "content": user},
    ]


def _parse_gate(text: str) -> tuple[str, str]:
    """Return ('alert', line) or ('silent', reason).

    Malformed replies default to silent — we'd rather miss a soft
    alert than spuriously interrupt the crew on a hallucinated ALERT."""
    stripped = (text or "").strip()
    if not stripped:
        return "silent", "empty gate response"
    m = _ALERT_RE.search(stripped)
    if m:
        line = m.group(1).strip()
        # Strip any trailing SILENT:… accidentally glued on.
        line = re.split(r"\n\s*SILENT\s*:", line, maxsplit=1,
                        flags=re.IGNORECASE)[0].strip()
        if line:
            return "alert", line
    if _SILENT_RE.search(stripped):
        return "silent", stripped
    return "silent", f"malformed gate response: {stripped[:120]!r}"


async def _run_gate(event: AlertEvent, *, timeout_s: float = 8.0) -> tuple[str, str]:
    """Call the cloud proxy for an ALERT/SILENT verdict. Returns
    ('alert', line) or ('silent', reason). Network failure → silent."""
    # cactus_proxy.complete is synchronous (httpx.Client). Offload so
    # we don't block the asyncio event loop.
    resp = await asyncio.to_thread(
        cactus_proxy.complete,
        _build_gate_messages(event),
        tools=None,
        pcm_data=None,
        local_draft="",
        timeout_s=timeout_s,
    )
    if not resp.get("ok"):
        return "silent", f"gate_unreachable: {resp.get('error')}"
    return _parse_gate(resp.get("response", ""))


async def process_event(
    event: AlertEvent,
    broadcaster: AlertBroadcaster,
    on_alert: Callable[[AlertPayload], None] | None = None,
    *,
    use_llm_gate: bool = True,
) -> AlertPayload | None:
    """Run Reasoner + Actor for one event.

    If `event.canned_text` is set, skip the LLM gate and speak the
    canned line (emergency/warning fast-path). Otherwise optionally
    run the gate; if the gate says SILENT, drop the event and return
    None. `use_llm_gate=False` is for tests + `/api/debug/fire_alert`
    where the operator wants an unconditional broadcast."""

    gate_kind = "canned"
    line: str

    if event.canned_text:
        line = event.canned_text
    elif not use_llm_gate:
        # Unconditional path: speak the summary directly.
        line = event.summary
        gate_kind = "operator"
    else:
        verdict, payload_text = await _run_gate(event)
        if verdict != "alert":
            print(
                f"[ora] event {event.event_id} → SILENT ({payload_text[:100]})",
                flush=True,
            )
            return None
        line = payload_text
        gate_kind = "llm"

    audio_b64 = await asyncio.to_thread(synth_wav_base64, line)
    payload = AlertPayload(
        event_id=event.event_id,
        name=event.name,
        severity=event.severity,
        module=event.module,
        text=line,
        audio_b64=audio_b64,
        source=event.source,
        timestamp=event.timestamp,
        gate=gate_kind,
    )
    await broadcaster.broadcast(payload)
    if on_alert is not None:
        try:
            on_alert(payload)
        except Exception as e:  # noqa: BLE001
            print(f"[ora] on_alert callback error: {e}", flush=True)
    print(
        f"[ora] alert fired: {event.event_id} gate={gate_kind} "
        f"sev={event.severity} text={line[:80]!r}",
        flush=True,
    )
    return payload


async def ora_loop(
    state_getter: Callable[[], ShipState | None],
    observer: Observer,
    broadcaster: AlertBroadcaster,
    on_alert: Callable[[AlertPayload], None] | None,
    stop_event: asyncio.Event,
    *,
    poll_hz: float = 1.0,
    enabled_getter: Callable[[], bool] | None = None,
) -> None:
    """Background coroutine. Polls the sim state, scans, processes.

    `enabled_getter` lets the operator pause proactive alerts mid-demo
    via a flag (see /api/debug/alerts/enable, /api/debug/alerts/pause).
    When disabled the observer still scans (so cooldown state stays
    accurate) but events are dropped before the Reasoner.
    """
    interval = 1.0 / poll_hz
    while not stop_event.is_set():
        state = state_getter()
        if state is not None:
            try:
                events = observer.scan(state)
            except Exception as e:  # noqa: BLE001
                print(f"[ora] observer.scan error: {e}", flush=True)
                events = []
            if events and (enabled_getter is None or enabled_getter()):
                for ev in events:
                    try:
                        await process_event(ev, broadcaster, on_alert)
                    except Exception as e:  # noqa: BLE001
                        print(f"[ora] process_event error for {ev.event_id}: {e}",
                              flush=True)
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=interval)
        except asyncio.TimeoutError:
            continue


def payload_to_sse(payload: AlertPayload) -> bytes:
    """Encode a payload as a single SSE `data:` frame. Clients receive
    a single-line JSON object per message; fields are stable across the
    Phase-2 protocol."""
    body = json.dumps(asdict(payload), separators=(",", ":"))
    return f"data: {body}\n\n".encode("utf-8")
