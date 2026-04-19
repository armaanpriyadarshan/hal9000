"""HAL's world model: a physics-based ISS telemetry simulator.

State vector spans 15 channels across ECLSS / TCS / EPS / GN&C, integrated
forward-Euler at 1 Hz from the FastAPI background task. Anomalies attach
as parameter modifiers on `ShipParams` (see anomalies.py); the tick
integrator reads the current params and produces new state.

The goal is *demo-plausible* behaviour, not a flight-dynamics model.
Nominal values and coupling structure are sourced from:
  - ISS Reference Guide NP-2015-05-022-JSC
  - OCHMO-TB-003 "Habitable Atmosphere" / OCHMO-TB-004 "Carbon Dioxide"
  - Gatens et al. NTRS 20180006142 "ISS ECLSS"
  - NASA ATCS Overview (473486main_iss_atcs_overview.pdf)

All cabin dynamics are isothermal ideal-gas mass balances; TCS and EPS
are first-order approximations. Orbit cadence is demo-accelerated
(3 min day / 2 min eclipse) so battery SoC and solar array current
visibly swing inside a pitch.
"""

from __future__ import annotations

import asyncio
import math
from dataclasses import dataclass, field


_R = 8.314            # J/(mol·K)
_V_CABIN = 916.0      # m³, ISS pressurised volume
_T_CABIN_K = 295.0    # K (≈ 22 °C), isothermal assumption

# Molar-mass lookup drives the mass↔partial-pressure conversion below.
# d(pp_i)/dt [kPa/s] = d(m_i)/dt [kg/s] × _KPA_PER_KG[i]
# where _KPA_PER_KG[i] = R·T / (V·M_i) × 1e-3.
_KPA_PER_KG: dict[str, float] = {
    "O2":  (_R * _T_CABIN_K) / (_V_CABIN * 0.032) * 1e-3,
    "N2":  (_R * _T_CABIN_K) / (_V_CABIN * 0.028) * 1e-3,
    "CO2": (_R * _T_CABIN_K) / (_V_CABIN * 0.044) * 1e-3,
}

_KG_PER_DAY_TO_KG_PER_S = 1.0 / 86400.0

# Per-crewmember metabolic forcing. OCHMO-TB-003 nominals.
_CREW_O2_CONS_KG_S  = 0.84 * _KG_PER_DAY_TO_KG_PER_S
_CREW_CO2_PROD_KG_S = 1.00 * _KG_PER_DAY_TO_KG_PER_S

# OGA nominal production for 6 crew. The real system modulates; we hold
# a fixed setpoint and let ACS makeup cover transient dips.
_OGA_NOMINAL_KG_S = 5.4 * _KG_PER_DAY_TO_KG_PER_S

# Demo orbit. Real ISS is 58 min sun / 35 min eclipse; we compress so the
# battery SoC swing and array-current step are visible on stage in a
# few-minute demo window.
_ORBIT_DAYLIGHT_S = 180.0
_ORBIT_ECLIPSE_S  = 120.0

# ACS makeup threshold. Real ISS commands makeup below ~150 mmHg (20 kPa)
# pO2. Set slightly above so the loop reacts before HAL's alert window.
_ACS_PO2_TRIGGER_KPA = 20.5
_ACS_MAKEUP_MULT = 2.0  # ×_OGA_NOMINAL when triggered

# CMG momentum growth under aero torque. Rough target: reach ~85% of
# envelope in 10 sim-minutes, which is when real ISS would schedule a
# Russian-segment desat.
_CMG_FILL_RATE_FRAC_PER_S = 0.85 / 600.0


@dataclass
class ShipParams:
    """Parameters perturbed by anomaly injection. Each field has a named
    nominal and a modifier semantics documented in anomalies.py."""

    # Cabin leak to space (kg/s total-air). 0 nominal; >0 on hull breach.
    leak_rate_kg_s: float = 0.0
    # OGA electrolysis rate (kg/s O2 into cabin). Tripped to 0 on H2
    # sensor / pump / stack fault.
    oga_rate_kg_s: float = _OGA_NOMINAL_KG_S
    # CDRA effectiveness. 1.0 removes CO2 at crew production rate; 0.0
    # means bed saturated or regen-valve stuck.
    cdra_efficiency: float = 1.0
    # Regen-bed backflow of CO2 into the cabin (kg/s). Real CDRA
    # failures can dump accumulated CO2 back through a stuck valve; we
    # use this to give operator-triggered CDRA anomalies demo-visible
    # pCO2 dynamics (the cabin is 916 m³ — without extra influx, pCO2
    # climbs at ~0.025 kPa/hr from crew alone, which is invisible on
    # stage). 0 nominal.
    cdra_bleed_kg_s: float = 0.0
    # External ammonia loop leakage (kg/s NH3 out of loop A).
    nh3_leak_kg_s: float = 0.0
    # Additive SARJ drive current from bearing degradation.
    sarj_extra_current_a: float = 0.0
    # IATCS moderate-temp-loop pump health. 1.0 nominal, 0 = stopped.
    mtl_pump_health: float = 1.0
    # Sabatier catalyst health. Decoupled from OGA in the sim (Sabatier
    # outage doesn't cascade into OGA trip for Phase 0 — revisit later).
    sabatier_health: float = 1.0

    def reset(self) -> None:
        self.leak_rate_kg_s = 0.0
        self.oga_rate_kg_s = _OGA_NOMINAL_KG_S
        self.cdra_efficiency = 1.0
        self.cdra_bleed_kg_s = 0.0
        self.nh3_leak_kg_s = 0.0
        self.sarj_extra_current_a = 0.0
        self.mtl_pump_health = 1.0
        self.sabatier_health = 1.0


@dataclass
class ShipState:
    # ECLSS — cabin gas
    p_total_kpa: float = 101.3
    pp_o2_kpa: float = 21.3
    pp_co2_kpa: float = 0.40
    pp_n2_kpa: float = 79.6   # tuned so sum equals p_total_kpa
    cabin_t_c: float = 22.5
    cabin_rh_pct: float = 50.0

    # ECLSS — equipment readouts (derived from params each tick)
    oga_o2_rate_kg_day: float = 5.4
    cdra_removal_kg_day: float = 6.0

    # TCS external (ammonia)
    loop_a_nh3_t_c: float = 2.8
    loop_b_nh3_t_c: float = 2.8
    ata_a_pressure_mpa: float = 2.62

    # EPS
    array_current_a: float = 200.0
    battery_soc_pct: float = 90.0
    sarj_motor_current_a: float = 0.15

    # GN&C
    cmg_momentum_frac: float = 0.10

    # Orbit clock
    orbit_phase: str = "day"          # "day" | "night"
    orbit_t_in_phase_s: float = 0.0

    # Sim meta
    t_sim_s: float = 0.0
    crew_count: int = 6
    params: ShipParams = field(default_factory=ShipParams)
    active_anomalies: list[str] = field(default_factory=list)

    @classmethod
    def nominal(cls) -> "ShipState":
        return cls()

    def reset_to_nominal(self) -> None:
        """Wipe this state back to its factory defaults in place.

        The background run_loop holds a direct reference to this
        ShipState, so we can't swap the object — we reset its fields.
        Used by POST /api/debug/full_reset to give the operator a
        clean slate (called automatically on client hard-refresh).
        """
        fresh = ShipState.nominal()
        self.p_total_kpa = fresh.p_total_kpa
        self.pp_o2_kpa = fresh.pp_o2_kpa
        self.pp_co2_kpa = fresh.pp_co2_kpa
        self.pp_n2_kpa = fresh.pp_n2_kpa
        self.cabin_t_c = fresh.cabin_t_c
        self.cabin_rh_pct = fresh.cabin_rh_pct
        self.oga_o2_rate_kg_day = fresh.oga_o2_rate_kg_day
        self.cdra_removal_kg_day = fresh.cdra_removal_kg_day
        self.loop_a_nh3_t_c = fresh.loop_a_nh3_t_c
        self.loop_b_nh3_t_c = fresh.loop_b_nh3_t_c
        self.ata_a_pressure_mpa = fresh.ata_a_pressure_mpa
        self.array_current_a = fresh.array_current_a
        self.battery_soc_pct = fresh.battery_soc_pct
        self.sarj_motor_current_a = fresh.sarj_motor_current_a
        self.cmg_momentum_frac = fresh.cmg_momentum_frac
        self.orbit_phase = fresh.orbit_phase
        self.orbit_t_in_phase_s = fresh.orbit_t_in_phase_s
        self.t_sim_s = fresh.t_sim_s
        self.crew_count = fresh.crew_count
        self.params.reset()
        self.active_anomalies.clear()

    def tick(self, dt_s: float = 1.0) -> None:
        """Advance one forward-Euler step."""
        self._tick_orbit(dt_s)
        self._tick_eclss(dt_s)
        self._tick_tcs(dt_s)
        self._tick_eps(dt_s)
        self._tick_gnc(dt_s)
        self.t_sim_s += dt_s

    # -- subsystem integrators ----------------------------------------

    def _tick_orbit(self, dt_s: float) -> None:
        self.orbit_t_in_phase_s += dt_s
        if self.orbit_phase == "day" and self.orbit_t_in_phase_s >= _ORBIT_DAYLIGHT_S:
            self.orbit_phase = "night"
            self.orbit_t_in_phase_s = 0.0
        elif self.orbit_phase == "night" and self.orbit_t_in_phase_s >= _ORBIT_ECLIPSE_S:
            self.orbit_phase = "day"
            self.orbit_t_in_phase_s = 0.0

    def _tick_eclss(self, dt_s: float) -> None:
        p = self.params
        crew = self.crew_count

        # Species-wise mass balance, then convert to pp via _KPA_PER_KG.
        o2_in_kg_s  = p.oga_rate_kg_s
        o2_out_kg_s = _CREW_O2_CONS_KG_S * crew
        crew_co2_kg_s = _CREW_CO2_PROD_KG_S * crew
        # CDRA bleed simulates regen-valve backflow on failure; only
        # operator-triggered. Scales demo pacing of the pCO2 climb.
        co2_in_kg_s = crew_co2_kg_s + p.cdra_bleed_kg_s
        # Scrubber removes CO2 up to the crew-matched rate scaled by
        # efficiency. The bleed term bypasses the scrubber — that's
        # exactly what a stuck-valve regen failure models.
        co2_out_kg_s = crew_co2_kg_s * p.cdra_efficiency

        # Split cabin leak across species by mole fraction. Rough but
        # good enough for demo; a real sonic-choke model would weight
        # by M_i too.
        pp_sum = max(self.pp_o2_kpa + self.pp_n2_kpa + self.pp_co2_kpa, 1e-6)
        frac_o2  = self.pp_o2_kpa  / pp_sum
        frac_n2  = self.pp_n2_kpa  / pp_sum
        frac_co2 = self.pp_co2_kpa / pp_sum
        leak = p.leak_rate_kg_s

        # ACS makeup bang-bang on low pO2. Real ACS has a tighter PID
        # and also a pN2 controller; this is deliberately simplistic so
        # the operator can watch OGA trip → pO2 sag → ACS kick in.
        if self.pp_o2_kpa < _ACS_PO2_TRIGGER_KPA:
            o2_in_kg_s += _ACS_MAKEUP_MULT * _OGA_NOMINAL_KG_S

        d_pp_o2  = (o2_in_kg_s  - o2_out_kg_s  - leak * frac_o2)  * _KPA_PER_KG["O2"]
        d_pp_co2 = (co2_in_kg_s - co2_out_kg_s - leak * frac_co2) * _KPA_PER_KG["CO2"]
        d_pp_n2  = (-leak * frac_n2) * _KPA_PER_KG["N2"]

        self.pp_o2_kpa  = max(0.0, self.pp_o2_kpa  + d_pp_o2  * dt_s)
        self.pp_co2_kpa = max(0.0, self.pp_co2_kpa + d_pp_co2 * dt_s)
        self.pp_n2_kpa  = max(0.0, self.pp_n2_kpa  + d_pp_n2  * dt_s)
        self.p_total_kpa = self.pp_o2_kpa + self.pp_n2_kpa + self.pp_co2_kpa

        # Cabin temp drifts up if the MTL pump is dead — lab rack heat
        # stops being carried away. Demo pacing: 0.1 °C/s at full
        # failure crosses the 28 °C threshold (from 22.5 °C) in ~55 s.
        if p.mtl_pump_health < 0.5:
            self.cabin_t_c += 0.1 * dt_s * (1.0 - p.mtl_pump_health)

        self.oga_o2_rate_kg_day  = p.oga_rate_kg_s * 86400.0
        self.cdra_removal_kg_day = co2_out_kg_s * 86400.0

    def _tick_tcs(self, dt_s: float) -> None:
        p = self.params
        if p.nh3_leak_kg_s > 0.0:
            # Nominal reservoir ≈ 150 kg/loop. Pressure tracks mass
            # linearly in this simplification (real behaviour is
            # dominated by accumulator and pump-head dynamics).
            self.ata_a_pressure_mpa = max(
                0.0,
                self.ata_a_pressure_mpa - (p.nh3_leak_kg_s / 150.0) * dt_s * 2.62,
            )
            self.loop_a_nh3_t_c += 0.002 * dt_s

    def _tick_eps(self, dt_s: float) -> None:
        p = self.params
        in_eclipse = self.orbit_phase == "night"

        # First-order approach to the target current (τ≈5s) so the
        # transition at orbit-phase edges isn't a step.
        target_a = 0.0 if in_eclipse else 200.0
        self.array_current_a += (target_a - self.array_current_a) * (
            1.0 - math.exp(-dt_s / 5.0)
        )

        # Battery swing tuned to give a visible DoD each orbit. These
        # are stage-effect numbers, not a real Coulomb balance.
        dsoc_pct_s = -0.30 if in_eclipse else 0.20
        self.battery_soc_pct = max(0.0, min(100.0,
            self.battery_soc_pct + dsoc_pct_s * dt_s))

        self.sarj_motor_current_a = 0.15 + p.sarj_extra_current_a

    def _tick_gnc(self, dt_s: float) -> None:
        # Monotone momentum accumulation. Real ISS desats every ~24h via
        # Russian thrusters; we let operators "force" via anomaly inject
        # for the demo rather than auto-desat.
        self.cmg_momentum_frac = min(1.0,
            self.cmg_momentum_frac + _CMG_FILL_RATE_FRAC_PER_S * dt_s)


async def run_loop(state: ShipState, stop_event: asyncio.Event,
                   tick_hz: float = 1.0) -> None:
    """Background integrator. Cancellable via stop_event.

    Sleeps with wait_for(stop_event) so shutdown is immediate rather
    than waiting out a pending asyncio.sleep(interval).
    """
    interval = 1.0 / tick_hz
    while not stop_event.is_set():
        try:
            state.tick(dt_s=interval)
        except Exception as e:  # noqa: BLE001
            # Don't let a sim bug kill the whole server process.
            print(f"[telemetry] tick error: {e}", flush=True)
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=interval)
        except asyncio.TimeoutError:
            continue


def build_telemetry_block(s: ShipState) -> str:
    """Render current state as a system-prompt block, mirroring the
    RAG context injection pattern. Prepended to the system message in
    server.messages_with_context each turn."""
    lines = [
        "[Live Ship Telemetry — 'as of right now'. Reference specific "
        "values when the crew asks about systems. This block refreshes "
        "every turn.]",
        "",
        "ECLSS — Atmosphere",
        f"  Cabin total pressure:      {s.p_total_kpa:6.2f} kPa    (nominal 101.3)",
        f"  pO2 (oxygen):              {s.pp_o2_kpa:6.2f} kPa    (nominal 21.3)",
        f"  pCO2 (carbon dioxide):     {s.pp_co2_kpa:6.2f} kPa    (nominal 0.40, caution > 0.53, alarm > 0.70)",
        f"  pN2 (nitrogen):            {s.pp_n2_kpa:6.2f} kPa    (nominal 79.6)",
        f"  Cabin temperature:         {s.cabin_t_c:6.1f} °C      (nominal 22.5)",
        f"  Relative humidity:         {s.cabin_rh_pct:6.1f} %",
        "",
        "ECLSS — Equipment",
        f"  OGA O2 generation rate:    {s.oga_o2_rate_kg_day:6.2f} kg/day (nominal 5.4)",
        f"  CDRA CO2 removal rate:     {s.cdra_removal_kg_day:6.2f} kg/day (nominal 6.0)",
        "",
        "TCS — External Ammonia Loops",
        f"  Loop A return temperature: {s.loop_a_nh3_t_c:6.1f} °C      (nominal 2.8)",
        f"  Loop B return temperature: {s.loop_b_nh3_t_c:6.1f} °C      (nominal 2.8)",
        f"  ATA A pressure:            {s.ata_a_pressure_mpa:6.2f} MPa    (nominal 2.62)",
        "",
        "EPS — Power",
        f"  Solar array current:       {s.array_current_a:6.1f} A       (~200 sunlight, ~0 eclipse)",
        f"  Battery SoC:               {s.battery_soc_pct:6.1f} %",
        f"  SARJ drive motor current:  {s.sarj_motor_current_a:6.2f} A      (nominal 0.15)",
        "",
        "GN&C",
        f"  CMG momentum stored:       {s.cmg_momentum_frac * 100:6.1f} % of envelope",
        "",
        f"Orbit phase: {s.orbit_phase.upper()} "
        f"({int(s.orbit_t_in_phase_s)}s elapsed in phase)",
    ]
    if s.active_anomalies:
        lines += ["", f"Active anomaly modifiers: {', '.join(s.active_anomalies)}"]
    lines.append("")
    return "\n".join(lines) + "\n"
