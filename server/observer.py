"""Observer tier of the ORA (Observer-Reasoner-Actor) loop.

Scans the telemetry ShipState each tick and produces AlertEvent
objects for anything the Reasoner might want to act on. Two sources:

  1. Active anomalies (operator-triggered via /api/debug/inject).
     Each carries a declared severity + module from anomalies.py.
  2. Hard threshold crossings on state variables — rapid depress,
     pO2 low, pCO2 high, ATA pressure sag, cabin overtemp, battery
     critical, SARJ current spike, CMG saturation.

Per-event cooldown prevents a single condition from re-firing every
second. Events carry `canned_text` for emergencies so the Actor can
bypass the LLM gate and speak immediately (hull breach is not the
time for 'should I interrupt?' reasoning).

The observer is state-aware only within the dedup/cooldown window —
it does not learn a baseline or run a statistical detector. A
learned detector (Chronos-Bolt / IMS clustering) is the Phase-3
upgrade path; for the demo the rule table is deterministic and
auditable.
"""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass, field
from typing import Callable

from anomalies import ANOMALIES
from telemetry import ShipState


Severity = str  # "advisory" | "caution" | "warning" | "emergency"


@dataclass(frozen=True)
class AlertEvent:
    """One anomaly observation ready for the Reasoner.

    `canned_text`: when present, the Actor speaks it verbatim without
    running the LLM gate. Reserved for emergencies where we want zero
    latency and zero ambiguity.
    """

    event_id: str            # stable dedup key, e.g. "threshold:rapid_depress"
    source: str              # "anomaly" | "threshold"
    name: str
    severity: Severity
    summary: str
    module: str | None       # canonical scene name for visual grounding
    canned_text: str | None  # bypass-gate line, only set for emergencies
    snapshot: dict           # relevant state at detection (LLM gate context)
    timestamp: float         # wall-clock time.time()


# One threshold check per tuple. A rule's `predicate` returns True when
# the condition holds for the current state. `severity` and `module`
# are static per rule; `summary` is formatted against the state so the
# Reasoner sees concrete numbers.
@dataclass(frozen=True)
class _Rule:
    event_id: str
    name: str
    severity: Severity
    module: str | None
    predicate: Callable[[ShipState], bool]
    summary_fn: Callable[[ShipState], str]
    canned_text: str | None = None


# ---- rule table ----------------------------------------------------
# Ordered by severity (emergency first) so the Reasoner sees the
# highest-priority event first when multiple fire simultaneously. The
# gate is per-event though, not per-tick, so ordering is only for
# determinism in logs.

_RULES: tuple[_Rule, ...] = (
    _Rule(
        event_id="threshold:rapid_depress",
        name="rapid_depress",
        severity="emergency",
        module="main_modules",
        # See `_scan_rate_rules` — rapid depress is a rate-of-change
        # check, not an instantaneous one. Keeping this rule here as a
        # registry entry; the actual dP/dt test lives in Observer.scan.
        predicate=lambda s: False,
        summary_fn=lambda s: f"Cabin pressure falling rapidly (p={s.p_total_kpa:.2f} kPa).",
        canned_text=(
            "PRIORITY ALERT. Cabin pressure is dropping rapidly. "
            "Commander, close all hatches immediately and don emergency "
            "oxygen. We may have a hull breach."
        ),
    ),
    _Rule(
        event_id="threshold:po2_critical",
        name="po2_critical",
        severity="emergency",
        module="main_modules",
        predicate=lambda s: s.pp_o2_kpa < 15.0,
        summary_fn=lambda s: f"pO2 at {s.pp_o2_kpa:.2f} kPa — asphyxiation risk.",
        canned_text=(
            "EMERGENCY. Cabin oxygen is critically low. Don oxygen "
            "masks now. Commander, I am compensating via ACS makeup."
        ),
    ),
    _Rule(
        event_id="threshold:pco2_warning",
        name="pco2_warning",
        severity="warning",
        module="tranquility",
        predicate=lambda s: s.pp_co2_kpa > 0.70,
        summary_fn=lambda s: (
            f"pCO2 at {s.pp_co2_kpa:.2f} kPa "
            f"({s.pp_co2_kpa / 0.133322:.1f} mmHg), above crew-exposure limit."
        ),
    ),
    _Rule(
        event_id="threshold:cabin_overtemp",
        name="cabin_overtemp",
        severity="warning",
        module="destiny",
        predicate=lambda s: s.cabin_t_c > 28.0,
        summary_fn=lambda s: f"Cabin temperature at {s.cabin_t_c:.1f} °C, above comfort band.",
    ),
    _Rule(
        event_id="threshold:battery_low",
        name="battery_low",
        severity="warning",
        module=None,
        predicate=lambda s: s.battery_soc_pct < 25.0,
        summary_fn=lambda s: f"Battery SoC at {s.battery_soc_pct:.1f}%, entering reserve.",
    ),
    _Rule(
        event_id="threshold:ata_pressure_low",
        name="ata_pressure_low",
        severity="warning",
        module="s0_truss",
        predicate=lambda s: s.ata_a_pressure_mpa < 2.40,
        summary_fn=lambda s: (
            f"ATA Loop A pressure at {s.ata_a_pressure_mpa:.2f} MPa "
            f"(nominal 2.62) — possible external ammonia leak."
        ),
    ),
    _Rule(
        event_id="threshold:pco2_caution",
        name="pco2_caution",
        severity="caution",
        module="tranquility",
        predicate=lambda s: s.pp_co2_kpa > 0.53,
        summary_fn=lambda s: (
            f"pCO2 at {s.pp_co2_kpa:.2f} kPa — above caution threshold. "
            f"CDRA performance may be degraded."
        ),
    ),
    _Rule(
        event_id="threshold:po2_low",
        name="po2_low",
        severity="caution",
        module="tranquility",
        predicate=lambda s: s.pp_o2_kpa < 20.5,
        summary_fn=lambda s: f"pO2 at {s.pp_o2_kpa:.2f} kPa — below ACS trigger.",
    ),
    _Rule(
        event_id="threshold:cmg_saturation",
        name="cmg_saturation",
        severity="caution",
        module=None,
        predicate=lambda s: s.cmg_momentum_frac > 0.85,
        summary_fn=lambda s: (
            f"CMG momentum at {s.cmg_momentum_frac * 100:.0f}% of envelope — "
            f"desaturation burn required."
        ),
    ),
    _Rule(
        event_id="threshold:sarj_current_high",
        name="sarj_current_high",
        severity="advisory",
        module="s0_truss",
        predicate=lambda s: s.sarj_motor_current_a > 0.50,
        summary_fn=lambda s: (
            f"Starboard SARJ drive current at {s.sarj_motor_current_a:.2f} A "
            f"(nominal 0.15). Bearing drift — track trend over multiple orbits."
        ),
    ),
)


def _snapshot(state: ShipState) -> dict:
    """Compact state dict for gate-prompt context. Only the fields the
    Reasoner actually uses — keep the prompt short to hold TTFT down."""
    return {
        "p_total_kpa": round(state.p_total_kpa, 3),
        "pp_o2_kpa": round(state.pp_o2_kpa, 3),
        "pp_co2_kpa": round(state.pp_co2_kpa, 3),
        "cabin_t_c": round(state.cabin_t_c, 2),
        "loop_a_nh3_t_c": round(state.loop_a_nh3_t_c, 2),
        "ata_a_pressure_mpa": round(state.ata_a_pressure_mpa, 3),
        "battery_soc_pct": round(state.battery_soc_pct, 1),
        "sarj_motor_current_a": round(state.sarj_motor_current_a, 3),
        "cmg_momentum_frac": round(state.cmg_momentum_frac, 3),
        "orbit_phase": state.orbit_phase,
        "active_anomalies": list(state.active_anomalies),
    }


# The rate-of-change rule for rapid depressurization. Real ISS alarm
# fires at ≥ 1 mmHg/min (~0.133 kPa/min). We set a slightly lower trip
# so HAL gets ahead of the crew-audible C&W tone during demo.
_RAPID_DEPRESS_KPA_PER_MIN = 0.10


class Observer:
    """Stateful observer. Remembers last-fire time per event_id to
    enforce cooldown, and last-seen pressure for dP/dt rate checks.

    Intended to be instantiated once by the FastAPI lifespan and reused
    across ticks. Not thread-safe; use from one asyncio task only."""

    def __init__(self, cooldown_s: float = 60.0):
        self.cooldown_s = cooldown_s
        self._last_fired: dict[str, float] = {}
        self._prev_pressure_kpa: float | None = None
        self._prev_pressure_t: float | None = None

    def reset_cooldowns(self) -> None:
        """Drop all cooldown records. Useful for tests and between
        demos when you want alerts to re-fire on next injection."""
        self._last_fired.clear()
        self._prev_pressure_kpa = None
        self._prev_pressure_t = None

    def scan(self, state: ShipState, now: float | None = None) -> list[AlertEvent]:
        now = now if now is not None else time.time()
        events: list[AlertEvent] = []

        # Active anomalies — one event per injected anomaly, respecting
        # cooldown. Anomaly events never carry canned_text; we want the
        # LLM to produce fresh phrasing each time.
        for name in state.active_anomalies:
            spec = ANOMALIES.get(name)
            if spec is None:
                continue
            eid = f"anomaly:{name}"
            if not self._cooled(eid, now):
                continue
            events.append(AlertEvent(
                event_id=eid,
                source="anomaly",
                name=name,
                severity=spec.severity,
                summary=spec.summary,
                module=spec.module,
                canned_text=None,
                snapshot=_snapshot(state),
                timestamp=now,
            ))

        # Rate-of-change: rapid depressurization. dP/dt needs a prior
        # sample; skip on the first scan.
        if self._prev_pressure_kpa is not None and self._prev_pressure_t is not None:
            dt = max(now - self._prev_pressure_t, 1e-6)
            dP_per_min = (state.p_total_kpa - self._prev_pressure_kpa) * 60.0 / dt
            if dP_per_min < -_RAPID_DEPRESS_KPA_PER_MIN:
                eid = "threshold:rapid_depress"
                rule = next(r for r in _RULES if r.event_id == eid)
                if self._cooled(eid, now):
                    events.append(AlertEvent(
                        event_id=eid,
                        source="threshold",
                        name=rule.name,
                        severity=rule.severity,
                        summary=(
                            f"Cabin pressure falling at "
                            f"{-dP_per_min:.2f} kPa/min "
                            f"(p={state.p_total_kpa:.2f} kPa)."
                        ),
                        module=rule.module,
                        canned_text=rule.canned_text,
                        snapshot=_snapshot(state),
                        timestamp=now,
                    ))
        self._prev_pressure_kpa = state.p_total_kpa
        self._prev_pressure_t = now

        # Static threshold rules. Skip the rate-only rule (handled
        # above) and emit any that match.
        for rule in _RULES:
            if rule.event_id == "threshold:rapid_depress":
                continue
            if not rule.predicate(state):
                continue
            if not self._cooled(rule.event_id, now):
                continue
            events.append(AlertEvent(
                event_id=rule.event_id,
                source="threshold",
                name=rule.name,
                severity=rule.severity,
                summary=rule.summary_fn(state),
                module=rule.module,
                canned_text=rule.canned_text,
                snapshot=_snapshot(state),
                timestamp=now,
            ))

        return events

    def _cooled(self, event_id: str, now: float) -> bool:
        last = self._last_fired.get(event_id, 0.0)
        if now - last < self.cooldown_s:
            return False
        self._last_fired[event_id] = now
        return True


def event_to_dict(event: AlertEvent) -> dict:
    """JSON-safe dict for logging and SSE payloads."""
    return asdict(event)
