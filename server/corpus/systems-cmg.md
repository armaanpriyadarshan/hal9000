# Control Moment Gyroscopes (CMGs)

The ISS uses four double-gimbaled CMGs on the Z1 truss for primary
attitude control. CMGs store angular momentum in spinning flywheels;
by tilting the flywheels' spin axes, they produce reaction torque
on the station.

## Specs

- Four units, each ~300 kg, flywheel spinning at ~6600 rpm.
- Combined momentum storage: ~12,000 N·m·s.
- Provides continuous non-propulsive attitude control — no
  propellant consumed, unlike thrusters.

## Why not thrusters alone?

Thrusters cost propellant and disturb microgravity experiments.
Thrusters also cause contamination (RCS plume residue on sensitive
surfaces). CMGs solve the routine-control problem silently and
cleanly.

## Saturation and desaturation

Over hours, external torques (gravity gradient, aerodynamic,
solar radiation pressure) accumulate momentum into the CMGs.
When CMGs approach saturation, their available torque reduces and
control degrades.

**Desaturation (desat)** — station fires thrusters on the Russian
segment to offload momentum. Routine, scheduled, crew-monitored
but hands-off.

## Failure modes

- **Single CMG failure** — station can maintain attitude on 3 of
  4. Reduced margin; desats more frequent.
- **Double CMG failure** — station may need to rely on thrusters
  for sustained control; propellant budget becomes a concern.
- **Triple failure** — degraded mode; thrusters primary;
  scheduled experiments suspended.

Historical ISS CMG failures have been repaired on-orbit via EVAs
to replace failed units with spares brought up on cargo vehicles.

## Role in emergency

CMG control is automatic and doesn't require crew action during
the big-three emergencies. If the event requires attitude change
(e.g., to aim damaged segment away from the Sun for cooling),
ground commands attitude maneuvers once comm is restored.

A CMG saturation during a long LOS could force a free-drift
period; this is not safety-critical but may affect solar panel
tracking and radiator pointing.
