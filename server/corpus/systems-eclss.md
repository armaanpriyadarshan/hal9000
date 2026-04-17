# Environmental Control and Life Support System (ECLSS)

ECLSS is the collective name for the hardware that keeps the cabin
habitable: oxygen generation, CO₂ removal, temperature/humidity
control, water recovery, trace contaminant scrubbing, and smoke/fire
detection.

## Major subsystems

### Oxygen supply

- **Oxygen Generation Assembly (OGA)** — electrolyzes water into
  oxygen and hydrogen. Located in Node 3. Nominal output ~5.5 kg
  O₂/day. Hydrogen is vented overboard or routed to the Sabatier.
- **Solid Fuel Oxygen Generator (SFOG) / "candles"** — backup
  oxygen supply using chemical cartridges that release O₂ on
  ignition. Short-duration, emergency use.
- **Oxygen tanks** on the airlock (for EVAs) and in Russian segment
  (via Elektron and backup tanks).
- **Elektron** — Russian electrolysis unit, equivalent to OGA, in
  Zvezda.

### CO₂ removal

- **CDRA** — two redundant Carbon Dioxide Removal Assemblies,
  zeolite-based molecular sieve. See `cdra.md`.
- **Vozdukh** — Russian CO₂ scrubber in Zvezda.
- **LiOH canisters** — short-duration backup for contingency use.
  Limited stowage.

### Temperature and humidity

- **Common Cabin Air Assembly (CCAA)** — one per US module, combines
  cooling coil (pulls water out of air) and fan (circulates). Water
  condensate feeds into the Water Processing Assembly.
- **Russian segment SKV** — equivalent function.

### Water recovery

- **Water Processing Assembly (WPA)** — recovers potable water from
  urine, condensate, and CO₂-scrubbing byproducts. See `wpa.md`.
- **Urine Processing Assembly (UPA)** — distills urine to potable
  water as input to WPA.

### Atmosphere quality

- **Trace Contaminant Control System (TCCS)** — charcoal + catalytic
  oxidizer, removes hundreds of trace volatile organics.
- **Major Constituent Analyzer (MCA)** — mass spectrometer, measures
  O₂, CO₂, N₂, H₂, CH₄, H₂O continuously.

### Fire detection

- Photoelectric smoke detectors in every rack and module.
- Crew-accessible portable fire extinguishers (PFEs) — CO₂ and
  water-mist.
- Portable Breathing Equipment (PBE) stowed at known locations.

## Redundancy philosophy

ECLSS is designed for two-fault tolerance on critical life-support
functions. O₂, CO₂ removal, and water recovery each have at least
two fully independent paths so that any single failure plus any
planned maintenance offline leaves the crew safe.
