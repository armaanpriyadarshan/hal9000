# Water Processing Assembly (WPA)

WPA recovers potable water from urine, cabin condensate, and other
onboard water sources. Located in Node 3. With the Urine Processing
Assembly (UPA) upstream, it closes ~90% of the station's water
loop.

## Inputs

- **Condensate** from the Common Cabin Air Assembly (CCAA) — water
  vapor from crew respiration and sweat, captured by the AC coil.
- **Urine distillate** from the UPA — urine pre-processed by
  distillation. UPA recovers ~80% of the water in urine as
  distillate.
- **Sabatier product water** — from the OGA/Sabatier loop.

## Processing steps

1. **Multifiltration** — particulate and activated-charcoal beds
   remove solids and organic compounds.
2. **Ion exchange** — removes dissolved ionic species.
3. **Catalytic oxidation** — destroys residual organics with a
   heated catalyst.
4. **Final polishing** — second ion-exchange pass.

Output is potable water that meets ISS water-quality standards for
drinking, food prep, and hygiene.

## Output capacity

- Processed water: ~60 L/day nominal.
- Stored potable water on board: tens of liters in bladders.

## Failure modes

- **Filter saturation** — filters are consumables; replacement is
  scheduled maintenance.
- **Catalyst bed degradation** — gradual; scheduled replacement.
- **UPA distillation unit failure** — upstream; halts urine
  recovery and forces increased water import from resupply or
  backup drink-bag supply.

## Emergency backup

- **Contingency Water Containers (CWC)** — drink bags filled on
  ground, flown up in cargo. Reserve for emergencies.
- **Russian water supply** — Rodnik tanks on Zvezda, resupplied by
  Progress. Cross-feedable to US segment.

Total reserve water typically ~200 L, enough for several days of
crew survival without WPA operation.

## Role in ammonia emergency

WPA itself is not directly affected by ammonia in the cabin.
However, if ammonia contaminates the condensate feed (through the
CCAA), WPA will need its filters inspected or replaced before
output is certified potable again.
