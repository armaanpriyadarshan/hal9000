"""Unit tests for server/telemetry.py and server/anomalies.py.

No asyncio in these — we call ShipState.tick() directly, which is what
the background loop does internally. That lets us simulate minutes of
ship time in milliseconds of wall time.
"""

from __future__ import annotations

import pytest

import anomalies as anomalies_lib
from telemetry import ShipState, build_telemetry_block


def _run(state: ShipState, seconds: int, dt: float = 1.0) -> None:
    """Integrate `seconds` of sim time at 1 Hz."""
    steps = int(seconds / dt)
    for _ in range(steps):
        state.tick(dt_s=dt)


# ---- nominal behaviour ---------------------------------------------


def test_initial_state_sums_to_total_pressure():
    s = ShipState.nominal()
    assert abs(s.p_total_kpa - (s.pp_o2_kpa + s.pp_n2_kpa + s.pp_co2_kpa)) < 1e-9


def test_nominal_holds_cabin_pressure_over_5_min():
    s = ShipState.nominal()
    _run(s, 300)
    # 5 minutes with no anomaly: pp_o2 and pp_co2 should stay within a
    # fraction of a kPa of nominal (OGA ≈ consumption, CDRA matches
    # production by design).
    assert 20.5 < s.pp_o2_kpa < 22.0, s.pp_o2_kpa
    assert 0.2 < s.pp_co2_kpa < 0.6, s.pp_co2_kpa
    assert 100.0 < s.p_total_kpa < 102.5, s.p_total_kpa


def test_orbit_phase_cycles_day_night_day():
    s = ShipState.nominal()
    assert s.orbit_phase == "day"
    _run(s, 181)  # just past daylight window
    assert s.orbit_phase == "night"
    _run(s, 121)  # just past eclipse
    assert s.orbit_phase == "day"


def test_battery_soc_falls_during_eclipse_and_recovers():
    s = ShipState.nominal()
    _run(s, 180)  # end of daylight
    soc_at_dusk = s.battery_soc_pct
    _run(s, 120)  # through eclipse
    soc_at_dawn = s.battery_soc_pct
    assert soc_at_dawn < soc_at_dusk, (soc_at_dusk, soc_at_dawn)
    _run(s, 120)
    assert s.battery_soc_pct > soc_at_dawn


def test_array_current_drops_in_eclipse():
    s = ShipState.nominal()
    _run(s, 180)  # sunlight window done
    _run(s, 60)   # 60s into eclipse, tau=5s so current has converged
    assert s.array_current_a < 5.0, s.array_current_a


def test_cmg_momentum_grows_monotonically():
    s = ShipState.nominal()
    m0 = s.cmg_momentum_frac
    _run(s, 120)
    assert s.cmg_momentum_frac > m0


# ---- anomaly injection ---------------------------------------------


def test_inject_unknown_anomaly_raises():
    s = ShipState.nominal()
    with pytest.raises(KeyError):
        anomalies_lib.inject(s, "definitely_not_real")


def test_slow_o2_leak_drops_total_pressure_monotonically():
    s = ShipState.nominal()
    anomalies_lib.inject(s, "slow_o2_leak", {"kpa_per_min": 0.2})
    p0 = s.p_total_kpa
    _run(s, 60)
    p1 = s.p_total_kpa
    _run(s, 60)
    p2 = s.p_total_kpa
    assert p1 < p0, (p0, p1)
    assert p2 < p1, (p1, p2)


def test_cdra_regen_fail_raises_ppco2():
    s = ShipState.nominal()
    anomalies_lib.inject(s, "cdra_regen_fail", {"efficiency": 0.0})
    co2_0 = s.pp_co2_kpa
    # Realistic rise for 6 crew in 916 m³ with CDRA off is ~0.025 kPa/hr
    # (Law et al. NTRS 20100021976). Run 30 sim-minutes for >0.01 kPa
    # above noise. Demo operators will want shorter timelines; they can
    # inject with cdra_removal_kg_day overridden negative (future), but
    # the physics here is deliberately faithful.
    _run(s, 1800)
    assert s.pp_co2_kpa > co2_0 + 0.005, (co2_0, s.pp_co2_kpa)


def test_ammonia_leak_drops_ata_pressure():
    s = ShipState.nominal()
    anomalies_lib.inject(s, "ammonia_loop_leak", {"rate_kg_s": 0.05})
    p0 = s.ata_a_pressure_mpa
    _run(s, 120)
    assert s.ata_a_pressure_mpa < p0


def test_sarj_bearing_drift_raises_drive_current():
    s = ShipState.nominal()
    anomalies_lib.inject(s, "sarj_bearing_drift", {"extra_current_a": 0.5})
    _run(s, 1)  # one tick applies the derived readout
    assert s.sarj_motor_current_a == pytest.approx(0.65, rel=1e-6)


def test_iatcs_mtl_pump_fail_drifts_cabin_temp_up():
    s = ShipState.nominal()
    t0 = s.cabin_t_c
    anomalies_lib.inject(s, "iatcs_mtl_pump_fail", {"health": 0.0})
    _run(s, 120)
    assert s.cabin_t_c > t0 + 0.5, (t0, s.cabin_t_c)


def test_cmg_saturation_sets_momentum_directly():
    s = ShipState.nominal()
    anomalies_lib.inject(s, "cmg_saturation", {"fraction": 0.9})
    assert s.cmg_momentum_frac >= 0.9


def test_clear_resets_params_but_keeps_state():
    s = ShipState.nominal()
    anomalies_lib.inject(s, "slow_o2_leak", {"kpa_per_min": 0.2})
    _run(s, 30)
    assert s.params.leak_rate_kg_s > 0
    assert "slow_o2_leak" in s.active_anomalies
    anomalies_lib.clear(s)
    assert s.params.leak_rate_kg_s == 0.0
    assert s.active_anomalies == []


def test_all_anomaly_specs_have_required_fields():
    # Sanity on the registry: every spec must carry the metadata Phase 2
    # will rely on for visual grounding and severity routing.
    for name, spec in anomalies_lib.ANOMALIES.items():
        assert spec.name == name
        assert spec.severity in {"advisory", "caution", "warning", "emergency"}
        assert spec.summary, name
        assert spec.module is None or isinstance(spec.module, str)


# ---- prompt block formatting ---------------------------------------


def test_build_telemetry_block_contains_key_labels():
    s = ShipState.nominal()
    block = build_telemetry_block(s)
    for label in (
        "Live Ship Telemetry",
        "Cabin total pressure",
        "pO2",
        "pCO2",
        "OGA O2 generation rate",
        "CDRA CO2 removal rate",
        "Battery SoC",
        "CMG momentum stored",
        "Orbit phase",
    ):
        assert label in block, label


def test_telemetry_block_lists_active_anomalies():
    s = ShipState.nominal()
    anomalies_lib.inject(s, "cdra_regen_fail")
    block = build_telemetry_block(s)
    assert "Active anomaly modifiers" in block
    assert "cdra_regen_fail" in block
