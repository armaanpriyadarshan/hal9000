# Cabin Air Scrubbing After Ammonia Exposure

Even after the leak is isolated, residual ammonia in the cabin
atmosphere must be removed before the crew can safely remove PBEs.
The station's air-revitalization hardware can scrub ammonia but was
designed for CO₂ and trace contaminant removal, not a bulk ammonia
event — scrubbing is slow.

## Hardware that adsorbs ammonia

- **Trace Contaminant Control System (TCCS)** in Node 3's Carbon
  Dioxide Removal Assembly (CDRA) bay. The TCCS charcoal bed adsorbs
  ammonia effectively. Baseline flow rate ~11 kg/hr.
- **CDRA zeolite beds.** Primarily CO₂ scrubbers but the zeolite also
  captures ammonia with reduced efficiency. Two CDRA units (one in US
  Lab, one in Node 3).
- **Russian Vozdukh** — equivalent CO₂ scrubber on the Russian segment.
  Adsorbs ammonia to a lesser extent.
- **Sabatier reactor / Oxygen Generation Assembly (OGA)** — not useful
  for scrubbing ammonia; take offline during an event to protect the
  catalyst bed.

## Crew actions during scrubbing

1. Verify TCCS is running at maximum flow.
2. Verify both CDRAs are running. If one is offline, leave it offline
   (the risk of introducing cabin air through its internal paths may
   contaminate it).
3. Increase Inter-Module Ventilation (IMV) between muster module and
   scrubbers so the muster air cycles through. This is
   counter-intuitive — you are deliberately pulling air *through*
   isolated hatches' IMV ducts — but IMV ducts have closeable valves
   that the crew can gate.
4. Do not open the source-side hatch even if scrubbers are also
   present there.

## Estimating time to safe concentration

Rule of thumb: the TCCS charcoal can draw cabin concentration below
the IDLH threshold in approximately **4–8 hours** for a moderate
leak (~100 g of ammonia released), and below the 7-day safe exposure
level in **12–24 hours**. A large leak (>1 kg) may not be recoverable
with on-orbit scrubbing alone — abandon-ship decision.

## Verification before unmasking

- Two sequential sensor readings below 10 ppm, taken 15 minutes apart.
- No crew symptoms (eye irritation, cough).
- Commander's go-ahead.

Even at 10 ppm, prolonged exposure causes chronic irritation.
Operational target for sustained cabin habitation is below 5 ppm.

## Filter saturation

After a significant event, the TCCS charcoal bed is saturated and must
be replaced on the next resupply. Note the filter state in the log and
pass to Mission Control during the next comm window.
