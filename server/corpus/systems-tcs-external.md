# External Active Thermal Control System (EATCS)

See also: `ammonia/15-source-loops.md` for the same loops as viewed
from the ammonia-emergency perspective.

## Purpose

Rejects the station's total heat load (~70 kW nominal) to space
via radiation. Without EATCS the station would overheat in hours.

## Architecture

Two independent loops (A and B), each with:

- **Pump Module** — centrifugal pump, speed-controlled.
- **Radiator panels** — six double-sided panels per loop, deployed
  from the truss, temperature ~0 to −50 °C depending on station
  attitude and solar exposure.
- **Ammonia Tank Assembly (ATA)** — reservoir + accumulator, ~150
  kg of anhydrous ammonia per loop.
- **Interface Heat Exchangers** — coupling to IATCS water loops.
- **Flow control valves**.

## Redundancy

Either loop alone can carry ~60% of the station load. With both
running, full margin. Single-loop operation is a well-understood
off-nominal mode, used during pump swaps, radiator deploys, and
after loop leaks.

## Radiator thermal management

- **Flash evaporator** — no, not used on ISS (legacy Shuttle
  hardware only).
- **Radiator attitude** — station attitude can pitch radiators
  toward or away from the Sun; the flight plan controls attitude
  to balance solar panel exposure against radiator rejection.
- **Nadir vs. zenith radiators** — nadir panels see Earth (warm),
  zenith panels see deep space (cold). Net rejection is positive
  in all nominal attitudes.

## Loop charge and vent

If a loop develops a leak to space (not to cabin), it slowly
vents its ammonia charge over hours. The surviving loop must carry
the full station load during and after this venting. Resupply
ammonia is carried on some cargo vehicles but is a finite
quantity.

If a loop develops a leak to cabin (the IFHX scenario), the leak
rate is small compared to the loop's reservoir, so the loop can
continue running for a while during the diagnosis, but stopping
the pump is still the right move to stop the ingress.

## Role in ammonia emergency

EATCS is the source. The external loop itself does not need to be
acted on during the emergency — the crew acts on the IATCS side
to stop pulling ammonia into the cabin. Permanent repair (patch or
replace the IFHX) is an EVA task done later.
