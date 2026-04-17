# Safe Haven Selection

## Priority order for muster point

With a toxic-atmosphere alarm, the crew groups in a module that maximizes
(1) distance from the suspected source, (2) proximity to escape vehicles,
and (3) integrity of the internal atmosphere.

**Default muster module: Node 1 (Unity).** It is centrally located, has
hatches on six ports, and sits at the boundary between US and Russian
segments. Both Soyuz(s) on the Russian side and Dragon on IDA-2/3 remain
reachable from here.

**Never muster in:**

- A module with an active IATCS cooling loop feeding a heat exchanger
  suspected of leaking.
- A module with a single hatch (single point of failure on egress).
- The airlock (Quest or Poisk) unless EVA prep already has the crew
  suited — the airlock is a constrained volume and not ideal for
  extended holding.

## Module volume as a factor

Larger-volume modules dilute a contaminant more slowly but also give the
scrubbers more air to work through. Smaller volumes reach dangerous
concentrations faster but can be purged faster once isolated.

Approximate pressurized volumes (rounded):

- Destiny (US Lab): ~106 m³
- Columbus: ~75 m³
- Kibo (JEM-PM): ~150 m³
- Zvezda (Service Module): ~90 m³
- Zarya (FGB): ~72 m³
- Nauka: ~70 m³
- Harmony (Node 2): ~65 m³
- Tranquility (Node 3): ~70 m³
- Unity (Node 1): ~55 m³

## Decision heuristics for the commander

- If leak is in US segment heat exchangers, muster on the Russian side
  (past Node 1 into Zarya or Zvezda).
- If leak is in Russian segment heat exchangers, muster on the US side
  (Harmony or a US lab module).
- If the segment is unknown after initial alarm, default to Node 1 and
  close both forward and aft hatches, then diagnose.

## When to change muster location

Re-muster if:

- Ammonia concentration in the muster module starts rising.
- The isolated hatch on the source side is found to be leaking (rare).
- A medical event in the current muster module requires access to
  medical stowage located elsewhere.

Re-mustering requires re-masking check, coordinated movement, and
re-closing hatches on the new side. Plan the move; do not improvise.
