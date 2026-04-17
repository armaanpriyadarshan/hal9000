# Guidance, Navigation, and Control (GNC)

## Attitude control

The ISS maintains attitude (orientation relative to Earth, Sun, and
velocity vector) using primarily **Control Moment Gyroscopes
(CMGs)**. When CMG torque is insufficient (during maneuvers or
desaturation), **thrusters** on a docked Progress or the Russian
segment provide additional torque.

### CMGs

See `cmg.md` for detail. Four CMGs on the Z1 truss. Momentum
storage device: electric motors spin flywheels whose tilt produces
torque on the station.

### Thrusters

- **Russian segment thrusters** — on Zvezda and Zarya. Hydrazine.
  Used for attitude control and orbital reboost.
- **Progress thrusters** — cargo vehicle has its own propulsion,
  used during docking and can be commanded for reboost while
  docked.
- **Cygnus thrusters** — commercial cargo, reboost-capable since
  2018.

## Nominal attitude modes

- **XVV (X-axis Velocity Vector)** — nominal, X-axis aligned with
  direction of motion. Most stable.
- **LVLH (Local Vertical Local Horizontal)** — Z-axis toward Earth.
  Used for visiting vehicle rendezvous.
- **Sun-tracking** — attitude that optimizes solar array exposure.
  Less common.

## Orbital parameters

- **Altitude** — maintained 400 ± 15 km by periodic reboosts.
- **Inclination** — 51.6° (a Baikonur-launchable inclination).
- **Orbit period** — ~92.7 minutes.
- **Velocity** — ~7.66 km/s ground-track.

## Reboost

The ISS loses ~2 km of altitude per month to atmospheric drag.
Reboost burns, typically by a docked Progress, restore altitude
every few months. Duration ~10–30 minutes, small delta-V
(~1–3 m/s).

Reboost schedule is coordinated with visiting vehicles and
microgravity-sensitive experiments.

## Role in emergency

GNC is not directly affected by ammonia, fire, or depress events.
However, during an emergency, attitude maneuvers are suspended to
avoid adding complexity. A controlled-free-drift mode is available
as a fallback if CMG control must be interrupted.
