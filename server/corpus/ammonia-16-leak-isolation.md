# Identifying and Isolating the Leak Source

Once the crew is masked, mustered, and segment-isolated, the next
phase is diagnosis. The goal is to determine *which* heat exchanger is
leaking, take it offline, and stop the flow of external ammonia into
the internal loops.

## Evidence to look at

1. **Which segment's sensors tripped first?** The TCS closest to the
   leak reaches threshold first. Correlate alarm-time with module.
2. **IATCS water-loop pressure.** The internal water loops sit at
   lower pressure than the external ammonia loops. A ruptured IFHX
   shows anomalous pressure *rise* on the water side as ammonia
   crosses into the water.
3. **External ammonia loop pressure.** Matching anomalous pressure
   *drop* on the external side of the same heat exchanger.
4. **Pump speed commands.** If a loop's pump is being commanded to a
   higher speed to maintain flow, that loop may be losing fluid.
5. **Visible evidence.** Liquid droplets or a visible plume near a
   heat exchanger bulkhead is strongly confirmatory.

Note: the crew does not need to positively identify the leaking
exchanger before beginning isolation. If the evidence points at a
specific side, proceed. If it does not, the default safe action is to
isolate **both** IATCS loops feeding heat exchangers on the
suspected-contaminated side.

## Isolation actions

1. **Stop the IATCS pump** on the low-pressure (water) side of the
   suspected heat exchanger. This stops pulling ammonia through the
   breach.
2. **Close isolation valves** on the water-side inlet and outlet of
   the heat exchanger.
3. **Vent the water side** to an empty accumulator if equipped, to
   pull residual ammonia out of the water lines.
4. **Do not vent the external ammonia loop.** Doing so would release
   more ammonia to space but is only warranted if the leak continues
   after the IATCS side is isolated and pump-stopped.

## Thermal consequences of isolation

Isolating one IATCS loop cuts that loop's thermal capacity. The
surviving loop can carry part of the load; non-critical equipment on
the isolated loop must be powered down to stay within thermal limits.

Typical powerdown targets:

- Non-critical experiments (first).
- Second redundant avionics units.
- Non-essential RPC channels.
- One CDRA (keep the other running for the ammonia scrub).

Life support, lighting, comms, and CMG control remain powered.

## Confirmation that the leak is stopped

- No further rise in cabin ammonia concentration over 30 minutes
  (concentration should start *dropping* as scrubbers work).
- IATCS water-side pressure stable.
- External loop pressure stable.

Once stopped, the scrubbing phase (file `13-air-scrubbing.md`) is the
remaining operation.
