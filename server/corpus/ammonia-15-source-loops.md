# External Ammonia Loops (EATCS) — Source of Potential Leaks

## What the EATCS does

The External Active Thermal Control System rejects heat the station
generates (crew, electronics, experiments, batteries) to space. It
consists of two independent, redundant loops:

- **Loop A** — serves the starboard truss and its equipment.
- **Loop B** — serves the port truss and its equipment.

Each loop contains:

- **Pump Module (PM)** — cryo-rated centrifugal pump, speed-controlled
  by the avionics. One per loop.
- **Radiator arrays** — six double-sided deployable radiator panels per
  loop, mounted on the port and starboard trusses.
- **Interface Heat Exchangers (IFHX)** — the boundary between external
  ammonia and the internal water loops. This is where a breach into the
  cabin can occur.
- **Ammonia Tank Assembly (ATA)** — reservoir + pressure control. Each
  loop has one ATA.
- **Flow control valves and instrumentation.**

## Working fluid properties (anhydrous ammonia)

- Boiling point: −33 °C at 1 atm — liquid state on-orbit thanks to
  loop pressure ~200 psi and heat-exchanger-limited temperature.
- Freezing point: −78 °C. The radiators can freeze during deep-space
  pointing if flow is interrupted; flow is kept above a minimum to
  prevent this.
- Heat capacity: high, ~4.7 kJ/(kg·K) — efficient coolant.

## Loop charge

Each loop holds approximately **150 kg** of ammonia as a nominal
charge. A catastrophic rupture of a single loop to the cabin would
release far more ammonia than the cabin volume can absorb — but in
practice, such a rupture would vent most of the ammonia to space
through the heat-exchanger-to-environment path, not into the cabin.
The cabin-threat scenario is a slow leak across a single heat
exchanger over minutes-to-hours.

## Operational history

The ISS has experienced several ammonia-related anomalies:

- **2013** — visible external ammonia leak from a radiator; resolved
  by EVA replacement of a pump control box. No cabin exposure.
- **2015** — false-alarm ATM event based on faulty sensor readings;
  the crew executed the full ammonia response before the false alarm
  was confirmed. Drill data validates the response procedure.

No confirmed cabin-side ammonia release has occurred on the ISS to
date. The system's ground training treats the scenario as
low-probability, high-consequence — rare enough to be almost an
anomaly, severe enough that every crewmember must execute the
response reflexively.

## Loop cross-feed

Either loop can carry the station's thermal load alone at reduced
margin. If Loop A is isolated for a leak event, Loop B absorbs the
thermal load of the whole truss at the cost of reduced radiator
throughput margin and increased radiator temperatures. This mode is
sustainable for weeks but places more stress on Loop B's pump and
radiators.
