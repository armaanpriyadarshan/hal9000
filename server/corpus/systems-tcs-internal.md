# Internal Active Thermal Control System (IATCS)

The IATCS moves heat from powered equipment inside pressurized
modules to the external thermal control loops. Working fluid: water
(not ammonia). Several independent loops serve different sections
of the station.

## Loops

- **Low-Temperature Loop (LTL)** — ~4 °C, serves equipment that
  needs cold cooling (cabin air heat exchangers, CDRA, some
  freezer racks).
- **Medium-Temperature Loop (MTL)** — ~17 °C, serves most rack
  equipment and the cabin CCAAs.

Each module has its own IATCS branch that can be isolated from
the main loops.

## Hardware

- **Pump Package Assembly (PPA)** — circulates water. Primary and
  backup in each loop.
- **Interface Heat Exchanger (IFHX)** — couples IATCS water to
  external EATCS ammonia. The potentially-leaking component.
- **Cold plates** — bolted to racks, water flows through; heat
  transfers by conduction.
- **Flow control valves** — segment-by-segment isolation.

## Normal operation

IATCS pulls heat from racks, carries it to the IFHX, transfers
it to the external ammonia loop. The internal loops are closed;
water does not leave the station in normal operation.

## Failure modes

- **Pump failure** — backup pump spins up; loop stays operational.
- **Pressure leak (internal)** — water leak into cabin. Not toxic
  but produces moisture hazard; MCA detects rising humidity. Can
  also damage electronics.
- **Heat exchanger breach** — **the ammonia-event source**. If the
  IFHX wall fails, ammonia crosses from the external loop into
  the IATCS water, then into cabin via any downstream water leak.
  Detected by IATCS pressure rise + ATM alarm.

## Role in ammonia emergency

IATCS is where the intervention happens. The leaking IFHX's
associated IATCS loop is the one to stop (shutdown pump, close
isolation valves). See `ammonia/16-leak-isolation.md`.

Equipment on the isolated IATCS branch loses cooling and must be
powered down within minutes to hours depending on its thermal
mass.
