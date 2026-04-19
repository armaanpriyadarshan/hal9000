"""Unit tests for observer.py — threshold + anomaly scanner.

All tests drive the observer with explicit `now` timestamps so
cooldown behaviour is deterministic and we don't depend on wall
clock."""

from __future__ import annotations

import anomalies as anomalies_lib
from observer import AlertEvent, Observer
from telemetry import ShipState


def _obs(cooldown_s: float = 60.0) -> Observer:
    return Observer(cooldown_s=cooldown_s)


def test_nominal_state_fires_no_events():
    s = ShipState.nominal()
    o = _obs()
    # Prime the rate detector so the second scan has a reference.
    o.scan(s, now=1000.0)
    events = o.scan(s, now=1001.0)
    assert events == []


def test_anomaly_injection_produces_one_event():
    s = ShipState.nominal()
    anomalies_lib.inject(s, "cdra_regen_fail")
    o = _obs()
    events = o.scan(s, now=1000.0)
    assert any(e.event_id == "anomaly:cdra_regen_fail" for e in events)
    hit = [e for e in events if e.event_id == "anomaly:cdra_regen_fail"][0]
    assert hit.source == "anomaly"
    assert hit.severity == "caution"
    assert hit.module == "tranquility"
    assert hit.canned_text is None, "anomaly events should never carry canned_text"


def test_cooldown_suppresses_refire_inside_window():
    s = ShipState.nominal()
    anomalies_lib.inject(s, "cdra_regen_fail")
    o = _obs(cooldown_s=60.0)
    first = o.scan(s, now=1000.0)
    second = o.scan(s, now=1030.0)  # 30s later, inside cooldown
    assert any(e.event_id == "anomaly:cdra_regen_fail" for e in first)
    assert all(e.event_id != "anomaly:cdra_regen_fail" for e in second)


def test_cooldown_allows_refire_after_window():
    s = ShipState.nominal()
    anomalies_lib.inject(s, "cdra_regen_fail")
    o = _obs(cooldown_s=60.0)
    o.scan(s, now=1000.0)
    second = o.scan(s, now=1061.0)  # 61s later
    assert any(e.event_id == "anomaly:cdra_regen_fail" for e in second)


def test_rapid_depress_emergency_and_canned_text():
    s = ShipState.nominal()
    o = _obs()
    o.scan(s, now=1000.0)        # prime dP/dt reference
    s.p_total_kpa = 99.0         # drop 2.3 kPa in 5s = 27 kPa/min (rapid)
    events = o.scan(s, now=1005.0)
    hits = [e for e in events if e.event_id == "threshold:rapid_depress"]
    assert len(hits) == 1
    assert hits[0].severity == "emergency"
    assert hits[0].canned_text is not None
    assert "PRIORITY" in hits[0].canned_text


def test_slow_pressure_drop_does_not_fire_rapid_depress():
    s = ShipState.nominal()
    o = _obs()
    o.scan(s, now=1000.0)
    # Drop 0.05 kPa in 60s = 0.05 kPa/min, below the 0.1 kPa/min trip.
    s.p_total_kpa -= 0.05
    events = o.scan(s, now=1060.0)
    assert all(e.event_id != "threshold:rapid_depress" for e in events)


def test_po2_critical_fires_emergency_with_canned_text():
    s = ShipState.nominal()
    s.pp_o2_kpa = 14.0
    o = _obs()
    events = o.scan(s, now=1000.0)
    hits = [e for e in events if e.event_id == "threshold:po2_critical"]
    assert hits and hits[0].severity == "emergency"
    assert hits[0].canned_text and "oxygen" in hits[0].canned_text.lower()


def test_pco2_warning_fires_above_0_70_kpa():
    s = ShipState.nominal()
    s.pp_co2_kpa = 0.75
    o = _obs()
    events = o.scan(s, now=1000.0)
    # Both caution and warning rules match when we cross 0.70; both
    # should fire since they have distinct event_ids.
    ids = {e.event_id for e in events}
    assert "threshold:pco2_warning" in ids
    assert "threshold:pco2_caution" in ids


def test_pco2_caution_fires_between_0_53_and_0_70():
    s = ShipState.nominal()
    s.pp_co2_kpa = 0.60
    o = _obs()
    events = o.scan(s, now=1000.0)
    ids = {e.event_id for e in events}
    assert "threshold:pco2_caution" in ids
    assert "threshold:pco2_warning" not in ids


def test_battery_low_fires_under_25_pct():
    s = ShipState.nominal()
    s.battery_soc_pct = 20.0
    o = _obs()
    events = o.scan(s, now=1000.0)
    assert any(e.event_id == "threshold:battery_low" for e in events)


def test_cmg_saturation_fires_over_85_pct():
    s = ShipState.nominal()
    s.cmg_momentum_frac = 0.9
    o = _obs()
    events = o.scan(s, now=1000.0)
    assert any(e.event_id == "threshold:cmg_saturation" for e in events)


def test_sarj_current_high_fires_over_0_5_a():
    s = ShipState.nominal()
    anomalies_lib.inject(s, "sarj_bearing_drift", {"extra_current_a": 0.6})
    s.tick()  # apply the readout mapping
    o = _obs()
    events = o.scan(s, now=1000.0)
    assert any(e.event_id == "threshold:sarj_current_high" for e in events)


def test_ata_pressure_low_fires_under_2_4_mpa():
    s = ShipState.nominal()
    s.ata_a_pressure_mpa = 2.30
    o = _obs()
    events = o.scan(s, now=1000.0)
    assert any(e.event_id == "threshold:ata_pressure_low" for e in events)


def test_threshold_summary_contains_concrete_numbers():
    s = ShipState.nominal()
    s.pp_co2_kpa = 0.82
    o = _obs()
    events = o.scan(s, now=1000.0)
    warn = next(e for e in events if e.event_id == "threshold:pco2_warning")
    assert "0.82" in warn.summary or "0.82 kPa" in warn.summary


def test_reset_cooldowns_allows_immediate_refire():
    s = ShipState.nominal()
    anomalies_lib.inject(s, "cdra_regen_fail")
    o = _obs()
    assert o.scan(s, now=1000.0)
    assert all(e.event_id != "anomaly:cdra_regen_fail"
               for e in o.scan(s, now=1001.0))
    o.reset_cooldowns()
    assert any(e.event_id == "anomaly:cdra_regen_fail"
               for e in o.scan(s, now=1002.0))


def test_snapshot_is_serialisable():
    import json
    s = ShipState.nominal()
    anomalies_lib.inject(s, "slow_o2_leak")
    o = _obs()
    events = o.scan(s, now=1000.0)
    for e in events:
        # asdict-style snapshot must survive JSON round-trip for SSE.
        json.dumps(e.snapshot)
