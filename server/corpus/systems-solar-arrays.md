# Solar Arrays and Sun-Tracking

## Legacy arrays (SAW)

Eight Solar Array Wings deployed from the integrated truss. Each
wing consists of two 34×12 m flexible blankets on either side of
a mast, covered in silicon photovoltaic cells. Full station array
area is approximately 2500 m², with iROSA adding more on top.

Arrays generate at peak:

- ~30 kW per wing beginning-of-life.
- ~20 kW per wing currently (degradation + shadowing by structure).

## iROSA arrays

Deployed 2021–2024 over six of the eight original wings. Smaller
roll-out flexible arrays sitting on top of the legacy SAW
structure at an offset angle. Provide redundant power plus boost
total generation by ~30%.

## Sun-tracking

- **SARJ** (Solar Alpha Rotary Joint) — rotates the entire outboard
  truss once per orbit so the arrays face the Sun. Two SARJs, one
  on port side and one on starboard, each driving one half of the
  outboard truss.
- **BGA** (Beta Gimbal Assembly) — tilts each wing individually to
  compensate for the seasonal variation in Sun angle. Can also
  feather wings (turn them edge-on) to reduce atmospheric drag.

## Feathering

When the station is in low-Sun-angle attitude or during certain
maneuvers, the BGAs can feather arrays to minimize drag. Feathered
arrays generate essentially zero power; the station runs on
battery.

## Daylight/eclipse cycle

- Orbit period: ~93 minutes.
- Daylight: ~58 minutes.
- Eclipse: ~35 minutes (station in Earth's shadow).

During daylight, arrays both power the station and charge the
batteries. During eclipse, batteries power the station. Battery
capacity is sized for ~1.3× the eclipse duration so there's
margin.

## Failure modes

- **SARJ drive failure** — locked joint, arrays no longer track
  Sun, generation reduced. Backup drive redundancy, but a long-
  term failure caps station power.
- **BGA stuck** — individual wing locked at off-angle, that wing
  at partial output.
- **Mast structural damage** — catastrophic failure mode, SAW
  becomes unusable; iROSA underneath unaffected.
- **Cell degradation** — slow, predictable, planned for.

## Ammonia-event relevance

Arrays themselves are thermally self-managed via radiative
cooling. Not a direct concern during an ammonia event. However,
battery heat must be rejected via the IATCS/EATCS thermal path;
if cooling capacity is reduced, batteries may have to reduce
discharge rate to stay within thermal limit.
