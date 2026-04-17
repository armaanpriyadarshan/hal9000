# Carbon Dioxide Removal Assembly (CDRA)

CDRA is the primary US-segment CO₂ scrubber. Two units, one in the
US Lab (Destiny), one in Node 3 (Tranquility). Either unit can
support the full crew on its own.

## Operating principle

Zeolite molecular sieve. Cabin air is blown through a bed of zeolite
pellets that selectively adsorb CO₂. When a bed is saturated, it is
heated and the CO₂ is desorbed to vacuum (overboard) or captured by
the Sabatier reactor for water recovery.

CDRA alternates between two beds so that one is adsorbing while the
other is regenerating, giving continuous operation.

## Specs

- Inlet CO₂ concentration target: below 4 mmHg partial pressure
  (crew-tolerable), preferred below 2.7 mmHg.
- CO₂ removal rate: sized to handle ~7 kg/day at full crew (7
  people, nominal activity).
- Power draw: ~900 W nominal.
- Cycle time: ~150 minutes per bed.

## Failure modes and consequences

- **Valve fault** — a stuck valve on bed-swap makes the assembly
  non-functional; the bed stops alternating and quickly saturates.
  Crew trips a caution alarm at elevated CO₂.
- **Vacuum line contamination** — if the desorption path is not
  fully venting, regenerated CO₂ re-accumulates. Degrades removal
  rate.
- **Zeolite degradation** — over years, the bed slowly loses
  capacity. Replacement is a scheduled EVA-free rack-swap task.

## Backup if CDRA cannot keep up

1. **Start second CDRA** — both units running in parallel can handle
   crew surges (visiting vehicle dockings bring more crew).
2. **Activate Vozdukh** on the Russian segment, cross-feed air
   through IMV between segments.
3. **Open LiOH canisters** — single-use chemical scrubbers. Each
   canister absorbs ~75 liters of CO₂. Crew opens them and they run
   passively. Stowage holds weeks of single-canister equivalent.

## Role in ammonia emergency

CDRA zeolite also adsorbs ammonia, so both CDRAs running at max flow
is part of the ammonia-scrubbing response. See
`ammonia/13-air-scrubbing.md`.
