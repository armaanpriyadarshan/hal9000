"""Emergency-response procedures that HAL can execute on crew request.

Each procedure is a state-mutation function. When the `execute_procedure`
tool is dispatched (see tools.py), the handler looks up the named
procedure here and applies it to ShipState — reversing the damage
of the corresponding anomaly so the crew experiences a real recovery
on telemetry (pCO2 drops, cabin pressure stops falling, etc.).

These aren't high-fidelity ISS crew procedures. They're demo-scale
compressions: one tool call ≈ one "do the whole emergency checklist".
Real ISS response for a hull breach is a multi-step hatch-close
sequence taking minutes; here we compress it into an instantaneous
state reset so the voice-confirmation → recovery cycle fits in a
demo window.

Corpus references (full procedures) live in server/corpus/.
"""

from __future__ import annotations

from typing import Callable

from telemetry import ShipState


def _remove_anomaly(state: ShipState, name: str) -> None:
    if name in state.active_anomalies:
        state.active_anomalies.remove(name)


def seal_breach(state: ShipState) -> str:
    """Close hatches + plug hull leak. Stops atmospheric venting."""
    state.params.leak_rate_kg_s = 0.0
    _remove_anomaly(state, "slow_o2_leak")
    # Even if cabin pressure dropped during the emergency, the
    # crew-in-sealed-module assumption means atmospheric loss halts
    # immediately. Bring p_total back toward nominal over a few
    # ticks implicitly — the integrator will stabilise once leak=0.
    return "Hatches closed. Cabin is sealed. Pressure loss arrested."


def recover_cdra(state: ShipState) -> str:
    """Clear the CDRA regen fault and scrub the accumulated CO2."""
    state.params.cdra_efficiency = 1.0
    state.params.cdra_bleed_kg_s = 0.0
    _remove_anomaly(state, "cdra_regen_fail")
    # Simulate a hard scrub pass — pCO2 returns to nominal immediately.
    # Real CDRA would take ~hours; demo compresses.
    if state.pp_co2_kpa > 0.45:
        state.pp_co2_kpa = 0.40
    return "CDRA secondary bed online. Carbon dioxide scrubbing restored."


def isolate_nh3_loop(state: ShipState) -> str:
    """Shut off the leaking external ammonia loop."""
    state.params.nh3_leak_kg_s = 0.0
    _remove_anomaly(state, "ammonia_loop_leak")
    _remove_anomaly(state, "toxic_atmosphere_nh3")
    # ATA pressure stabilises where it is; no quick-fill mechanism
    # in the sim. Loop temps return to nominal on next orbit pass.
    return "Ammonia loop A isolated. Leak halted. Loop B carrying full load."


def suppress_fire(state: ShipState) -> str:
    """Deploy fire suppression + vent affected module."""
    state.params.mtl_pump_health = 1.0
    _remove_anomaly(state, "iatcs_mtl_pump_fail")
    _remove_anomaly(state, "cabin_fire")
    # Cabin temp drops back to setpoint once cooling is restored.
    if state.cabin_t_c > 25.0:
        state.cabin_t_c = 22.5
    return "Fire suppression deployed. Affected segment depressurised and cleared."


def desaturate_cmgs(state: ShipState) -> str:
    """Execute a desat burn — zero accumulated CMG momentum."""
    state.cmg_momentum_frac = 0.10
    _remove_anomaly(state, "cmg_saturation")
    return "Desaturation burn complete. Control-moment-gyro momentum nominal."


PROCEDURES: dict[str, Callable[[ShipState], str]] = {
    "seal_breach":      seal_breach,
    "recover_cdra":     recover_cdra,
    "isolate_nh3_loop": isolate_nh3_loop,
    "suppress_fire":    suppress_fire,
    "desaturate_cmgs":  desaturate_cmgs,
}


def execute(state: ShipState, action: str) -> str:
    """Dispatch a named procedure. Returns the human-readable
    confirmation line HAL will speak. Raises KeyError on unknown
    action so tools.dispatch can report it as a failed_call."""
    fn = PROCEDURES[action]
    return fn(state)
