"""Anomaly injection for the telemetry simulator.

Each anomaly is a parameter modifier — a named set of overrides applied
to `ShipState.params`. The tick integrator in telemetry.py reads those
params and produces anomalous dynamics without any special-casing.

Every anomaly carries:
- `name`          — canonical key used in /api/debug/inject
- `severity`      — advisory | caution | warning | emergency
                    (drives Phase 2 LLM-gate vs. canned-alert routing)
- `module`        — canonical location matching set_view / highlight_part /
                    navigate_to enums in tools.py. None when the anomaly
                    has no natural visual anchor (e.g. CMG saturation).
- `summary`       — one-line description for HAL's awareness prompt
- `apply(params)` — mutates ShipParams; safe to call idempotently

Seven scenarios, all grounded in corpus procedures:
  1. slow_o2_leak           → emergencies-mmod-strike.md, systems-eclss.md
  2. cdra_regen_fail        → systems-cdra.md
  3. ammonia_loop_leak      → ammonia-*.md
  4. sarj_bearing_drift     → systems-solar-arrays.md
  5. cmg_saturation         → systems-cmg.md
  6. iatcs_mtl_pump_fail    → systems-tcs-internal.md
  7. sabatier_catalyst_cool → systems-oga.md

The classic fire / rapid-depress / toxic-atmosphere emergencies are NOT
here — those will be triggered by crossing alarm thresholds on the
physical state, not by parameter injection. Phase 2 will wire those.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from telemetry import ShipParams, ShipState


Severity = str  # "advisory" | "caution" | "warning" | "emergency"


@dataclass(frozen=True)
class AnomalySpec:
    name: str
    summary: str
    severity: Severity
    module: str | None
    apply: Callable[[ShipParams, dict], None]


def _slow_o2_leak(params: ShipParams, kwargs: dict) -> None:
    # Demo default: 1.0 kPa/min — fast enough that pO2 crosses the
    # 20.5 kPa ACS-trigger within ~48 s (and would threshold-fire the
    # caution `po2_low` rule if ACS wasn't compensating). Realistic
    # hull-micro-breach rate is 0.01-0.1 kPa/min; pass a smaller
    # `kpa_per_min` override if the demo wants sub-alarm drift.
    kpa_per_min = float(kwargs.get("kpa_per_min", 1.0))
    # Convert to total mass-loss rate: dp/dt = (RT/V) × dm/dt × (1/M_mix).
    # For air M ≈ 0.029 kg/mol. Invert: dm/dt ≈ dp/dt × V × M / (R·T).
    dp_pa_s = (kpa_per_min * 1000.0) / 60.0
    m_air = 0.029
    params.leak_rate_kg_s = dp_pa_s * 916.0 * m_air / (8.314 * 295.0)


def _cdra_regen_fail(params: ShipParams, kwargs: dict) -> None:
    # Valve fault → one bed saturates (efficiency → 0) AND regen-bed
    # backflow dumps accumulated CO2 into the cabin (`cdra_bleed_kg_s`).
    # Demo pacing: 0.05 kg/s bleed crosses the 0.53 kPa caution
    # threshold (from 0.40) in ~45 s and warning (0.70) in ~2 min.
    # Operator can dial either independently via kwargs.
    params.cdra_efficiency = float(kwargs.get("efficiency", 0.0))
    params.cdra_bleed_kg_s = float(kwargs.get("bleed_kg_s", 0.05))


def _ammonia_loop_leak(params: ShipParams, kwargs: dict) -> None:
    # Demo default 0.05 kg/s — ATA A pressure crosses the 2.40 MPa
    # threshold (from 2.62) in ~30 s. Realistic external-loop leaks
    # are 0.001-0.01 kg/s and take hours, which doesn't read on stage.
    params.nh3_leak_kg_s = float(kwargs.get("rate_kg_s", 0.05))


def _sarj_bearing_drift(params: ShipParams, kwargs: dict) -> None:
    # Real SARJ: drive current climbs from 0.15 A toward 0.8 A over
    # days. Compressed: default adds 0.5 A instantly so the drift is
    # immediately visible on stage. Operator can pass a smaller delta.
    params.sarj_extra_current_a = float(kwargs.get("extra_current_a", 0.5))


def _cmg_saturation(params: ShipParams, kwargs: dict) -> None:
    # Not a params modifier — this anomaly directly pushes the state's
    # cmg_momentum_frac. The dispatcher below handles state-direct
    # mutations via a separate pathway.
    pass


def _iatcs_mtl_pump_fail(params: ShipParams, kwargs: dict) -> None:
    # Pump health default 0.0 (hard failure). Cabin temp drift kicks in
    # at < 0.5 per the tick logic.
    params.mtl_pump_health = float(kwargs.get("health", 0.0))


def _sabatier_catalyst_cool(params: ShipParams, kwargs: dict) -> None:
    params.sabatier_health = float(kwargs.get("health", 0.0))


def _apply_cmg_saturation(state: ShipState, kwargs: dict) -> None:
    state.cmg_momentum_frac = float(kwargs.get("fraction", 0.88))


ANOMALIES: dict[str, AnomalySpec] = {
    "slow_o2_leak": AnomalySpec(
        name="slow_o2_leak",
        summary="Sub-alarm cabin O2 leak (MMOD micro-breach)",
        severity="caution",
        module="main_modules",
        apply=_slow_o2_leak,
    ),
    "cdra_regen_fail": AnomalySpec(
        name="cdra_regen_fail",
        summary="CDRA bed regen valve fault — CO2 removal degraded",
        severity="caution",
        module="tranquility",
        apply=_cdra_regen_fail,
    ),
    "ammonia_loop_leak": AnomalySpec(
        name="ammonia_loop_leak",
        summary="External ammonia loop A leak — overboard, not cabin",
        severity="warning",
        module="s0_truss",
        apply=_ammonia_loop_leak,
    ),
    "sarj_bearing_drift": AnomalySpec(
        name="sarj_bearing_drift",
        summary="Starboard SARJ bearing degradation — drive current climbing",
        severity="advisory",
        module="s0_truss",
        apply=_sarj_bearing_drift,
    ),
    "cmg_saturation": AnomalySpec(
        name="cmg_saturation",
        summary="CMG momentum near envelope — desat burn required",
        severity="caution",
        module=None,
        apply=_cmg_saturation,
    ),
    "iatcs_mtl_pump_fail": AnomalySpec(
        name="iatcs_mtl_pump_fail",
        summary="IATCS moderate-temp-loop pump failure — rack cooling lost",
        severity="warning",
        module="destiny",
        apply=_iatcs_mtl_pump_fail,
    ),
    "sabatier_catalyst_cool": AnomalySpec(
        name="sabatier_catalyst_cool",
        summary="Sabatier reactor below catalyst light-off temperature",
        severity="advisory",
        module="tranquility",
        apply=_sabatier_catalyst_cool,
    ),
}


def inject(state: ShipState, name: str, kwargs: dict | None = None) -> AnomalySpec:
    """Apply an anomaly by name to `state`. Raises KeyError if unknown."""
    spec = ANOMALIES[name]
    kwargs = kwargs or {}
    spec.apply(state.params, kwargs)
    # CMG saturation mutates state directly (see _apply_cmg_saturation).
    if name == "cmg_saturation":
        _apply_cmg_saturation(state, kwargs)
    if name not in state.active_anomalies:
        state.active_anomalies.append(name)
    return spec


def clear(state: ShipState) -> None:
    """Reset all params to nominal and drop active-anomaly tags. Leaves
    state variables (pp values, battery SoC, etc.) where they are — the
    ODE will relax toward nominal on subsequent ticks."""
    state.params.reset()
    state.active_anomalies.clear()
