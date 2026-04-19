"""Unit tests for ora.py — reasoner gate + actor + broadcaster.

The cloud LLM and Piper TTS are both monkeypatched so tests run with
zero network I/O and no audio synthesis."""

from __future__ import annotations

import asyncio
import base64
import json
import time
from dataclasses import asdict

import pytest

import ora
from observer import AlertEvent
from ora import (
    AlertBroadcaster,
    AlertPayload,
    _parse_gate,
    payload_to_sse,
    process_event,
)


# ---- shared fixtures -----------------------------------------------


def _event(
    severity: str = "caution",
    canned: str | None = None,
    name: str = "test_anomaly",
) -> AlertEvent:
    return AlertEvent(
        event_id=f"anomaly:{name}",
        source="anomaly",
        name=name,
        severity=severity,
        summary=f"Test summary for {name}",
        module="tranquility",
        canned_text=canned,
        snapshot={"pp_o2_kpa": 21.3, "pp_co2_kpa": 0.4},
        timestamp=1000.0,
    )


@pytest.fixture(autouse=True)
def stub_tts(monkeypatch):
    """Replace Piper TTS with a deterministic stub. Tests should never
    actually synthesise audio — it's slow and hardware-dependent."""
    def fake(text: str) -> str:
        payload = f"WAV({text})".encode("utf-8")
        return base64.b64encode(payload).decode("ascii")
    monkeypatch.setattr(ora, "synth_wav_base64", fake)


# ---- parser tests --------------------------------------------------


def test_parse_gate_alert_extracts_line():
    verdict, line = _parse_gate("ALERT: Commander, pCO2 is rising.")
    assert verdict == "alert"
    assert line == "Commander, pCO2 is rising."


def test_parse_gate_silent_returns_reason():
    verdict, reason = _parse_gate("SILENT: sub-alarm drift, no action")
    assert verdict == "silent"
    assert "sub-alarm" in reason


def test_parse_gate_alert_multiline_keeps_first_block():
    verdict, line = _parse_gate(
        "ALERT: Commander, coolant pressure trending low.\n"
        "Recommend checking loop A quantity."
    )
    assert verdict == "alert"
    assert line.startswith("Commander, coolant")


def test_parse_gate_malformed_defaults_silent():
    verdict, _ = _parse_gate("I think maybe we should alert the crew")
    assert verdict == "silent"


def test_parse_gate_empty_defaults_silent():
    verdict, _ = _parse_gate("")
    assert verdict == "silent"


def test_parse_gate_strips_trailing_silent_bleedthrough():
    # Real models occasionally emit both markers. We should keep just
    # the ALERT line.
    verdict, line = _parse_gate(
        "ALERT: Commander, cabin temperature rising.\nSILENT: actually no"
    )
    assert verdict == "alert"
    assert "SILENT" not in line


# ---- process_event tests -------------------------------------------
# pytest-asyncio is not in requirements.txt; we drive async tests via
# asyncio.run() directly rather than adding a plugin just for phase 2.


def test_emergency_canned_bypasses_gate(monkeypatch):
    """If the event has canned_text, the LLM gate must not be called."""
    called = {"n": 0}
    async def boom(*a, **k):
        called["n"] += 1
        raise AssertionError("gate should not be called for canned events")
    monkeypatch.setattr(ora, "_run_gate", boom)

    async def body():
        ev = _event(severity="emergency", canned="EMERGENCY. Don masks.")
        b = AlertBroadcaster()
        payload = await process_event(ev, b, on_alert=None)
        assert payload is not None
        assert payload.text == "EMERGENCY. Don masks."
        assert payload.gate == "canned"
        assert called["n"] == 0
    asyncio.run(body())


def test_caution_routes_through_gate_alert(monkeypatch):
    async def fake_gate(event, *, timeout_s=8.0):
        return "alert", "Commander, CDRA performance has degraded."
    monkeypatch.setattr(ora, "_run_gate", fake_gate)

    async def body():
        ev = _event(severity="caution", canned=None)
        b = AlertBroadcaster()
        payload = await process_event(ev, b)
        assert payload is not None
        assert payload.gate == "llm"
        assert payload.text.startswith("Commander")
    asyncio.run(body())


def test_caution_gate_silent_returns_none(monkeypatch):
    async def fake_gate(event, *, timeout_s=8.0):
        return "silent", "can wait"
    monkeypatch.setattr(ora, "_run_gate", fake_gate)

    async def body():
        ev = _event(severity="caution", canned=None)
        b = AlertBroadcaster()
        payload = await process_event(ev, b)
        assert payload is None
    asyncio.run(body())


def test_non_advisory_gate_unreachable_falls_back_to_summary(monkeypatch):
    """When the cloud proxy is down, non-advisory events must still
    reach the crew — fall back to the observer's summary text rather
    than letting network weather silence HAL."""
    async def fake_gate(event, *, timeout_s=8.0):
        return "unreachable", "gate_unreachable: timeout"
    monkeypatch.setattr(ora, "_run_gate", fake_gate)

    for sev in ("caution", "warning", "emergency"):
        async def body():
            ev = _event(severity=sev, canned=None)
            b = AlertBroadcaster()
            payload = await process_event(ev, b)
            assert payload is not None, f"{sev} dropped when gate unreachable"
            assert payload.gate == "fallback_summary"
            assert payload.text == ev.summary
        asyncio.run(body())


def test_advisory_gate_unreachable_stays_silent(monkeypatch):
    """Advisory-severity sub-alarm drift should still go silent on a
    gate failure — it wasn't worth interrupting for in the first
    place, so noise during proxy outage is worse than silence."""
    async def fake_gate(event, *, timeout_s=8.0):
        return "unreachable", "gate_unreachable: timeout"
    monkeypatch.setattr(ora, "_run_gate", fake_gate)

    async def body():
        ev = _event(severity="advisory", canned=None)
        b = AlertBroadcaster()
        payload = await process_event(ev, b)
        assert payload is None
    asyncio.run(body())


def test_use_llm_gate_false_speaks_summary():
    """Operator-forced alert path — no canned, no gate, speak summary."""
    async def body():
        ev = _event(severity="caution", canned=None)
        b = AlertBroadcaster()
        payload = await process_event(ev, b, use_llm_gate=False)
        assert payload is not None
        assert payload.gate == "operator"
        assert payload.text == ev.summary
    asyncio.run(body())


def test_on_alert_callback_fires_on_payload():
    seen: list[AlertPayload] = []
    def cb(p): seen.append(p)

    async def body():
        ev = _event(severity="emergency", canned="Hello crew.")
        b = AlertBroadcaster()
        await process_event(ev, b, on_alert=cb)
    asyncio.run(body())
    assert len(seen) == 1
    assert seen[0].text == "Hello crew."


def test_on_alert_exception_does_not_break_flow():
    def bad_cb(p): raise RuntimeError("boom")

    async def body():
        ev = _event(severity="emergency", canned="Hello.")
        b = AlertBroadcaster()
        return await process_event(ev, b, on_alert=bad_cb)
    payload = asyncio.run(body())
    # Exception in callback should NOT nullify the broadcast path.
    assert payload is not None


# ---- broadcaster fan-out -------------------------------------------


def test_broadcaster_fan_out_to_all_subscribers():
    async def body():
        b = AlertBroadcaster()
        q1 = await b.subscribe()
        q2 = await b.subscribe()
        ev = _event(severity="emergency", canned="Hi")
        await process_event(ev, b)
        p1 = await asyncio.wait_for(q1.get(), timeout=1.0)
        p2 = await asyncio.wait_for(q2.get(), timeout=1.0)
        assert p1.text == "Hi"
        assert p2.text == "Hi"
    asyncio.run(body())


def test_broadcaster_unsubscribe_stops_delivery():
    async def body():
        b = AlertBroadcaster()
        q = await b.subscribe()
        await b.unsubscribe(q)
        ev = _event(severity="emergency", canned="Hi")
        await process_event(ev, b)
        assert q.empty()
    asyncio.run(body())


def test_broadcaster_drops_oldest_when_full():
    async def body():
        b = AlertBroadcaster(per_sub_capacity=2)
        q = await b.subscribe()
        # Fill directly with dummy payloads so we don't need 3 process_events.
        for i in range(3):
            dummy = AlertPayload(
                event_id=f"dummy_{i}",
                name="dummy",
                severity="advisory",
                module=None,
                text=f"msg {i}",
                audio_b64="",
                source="test",
                timestamp=0.0,
                gate="canned",
            )
            await b.broadcast(dummy)
        items = []
        while not q.empty():
            items.append(await q.get())
        # Oldest (msg 0) must have been dropped; only msgs 1 and 2 remain.
        assert [p.text for p in items] == ["msg 1", "msg 2"]
    asyncio.run(body())


def test_subscriber_count_tracks_subscribe_unsubscribe():
    # Using an asyncio-free path: subscribe_count just reads the list,
    # so we can exercise it inside an event loop via asyncio.run.
    async def body():
        b = AlertBroadcaster()
        assert b.subscriber_count() == 0
        q1 = await b.subscribe()
        q2 = await b.subscribe()
        assert b.subscriber_count() == 2
        await b.unsubscribe(q1)
        assert b.subscriber_count() == 1
        await b.unsubscribe(q2)
        assert b.subscriber_count() == 0
    asyncio.run(body())


# ---- SSE frame encoding --------------------------------------------


def test_payload_to_sse_frame_is_well_formed():
    payload = AlertPayload(
        event_id="test:1",
        name="slow_o2_leak",
        severity="caution",
        module="main_modules",
        text="Commander, pO2 trending down.",
        audio_b64="AAAA",
        source="anomaly",
        timestamp=1234.5,
        gate="llm",
    )
    raw = payload_to_sse(payload)
    assert raw.endswith(b"\n\n")
    assert raw.startswith(b"data: ")
    body = raw[len(b"data: "):-2].decode("utf-8")
    parsed = json.loads(body)
    assert parsed["event_id"] == "test:1"
    assert parsed["text"].startswith("Commander")
    assert parsed["gate"] == "llm"
