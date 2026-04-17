# Toxic Atmosphere (ATM Alarm)

An ATM alarm fires when any monitored contaminant exceeds
its warning threshold. Ammonia is the most-feared source but not
the only possibility.

## Common triggers

- **Ammonia** from external-to-internal loop leakage (see `ammonia/`
  folder for full scenario).
- **Fire byproducts** — CO, HCl, HCN from burning plastic/wiring.
  Usually a fire alarm precedes or accompanies the ATM.
- **Refrigerant or lab chemical release** — specific experiments
  carry small quantities of potentially toxic substances.
- **Hydrazine contamination** after an EVA, via suit residue on
  equipment brought back through the airlock. Rare; managed by EVA
  decontamination protocol in the airlock before hatch open.
- **Mercury release** — isolated historical concern from broken
  thermometers; modern station has minimal mercury sources.

## Response hierarchy

The right initial response is identical regardless of contaminant:

1. Mask up (PBE on).
2. Muster.
3. Isolate segment.

Only after those three steps does diagnosis begin. Correct
identification of the contaminant is unnecessary for immediate
protection.

## Diagnostic step

Read the C&W panel to identify which sensor tripped and in which
module. This gives both the contaminant type (if the sensor is a
specific detector like the TCS) and the location.

Correlate with:

- Recent crew activity (did someone open a lab sample?)
- Recent system events (pump anomaly, heat exchanger temperature
  spike?)
- Visible indicators in any module the crew can see from muster.

## When to abort the response

The crew continues the toxic-atmosphere response until:

- Sensor readings confirm safe levels across the station, and
- Scrubbers have had time to process the full cabin volume at
  least twice (~4+ hours for most contaminants), and
- No crewmember is showing delayed symptoms.

False alarms have occurred on the ISS (most notably 2015). The
correct response to a false alarm is the same as a real alarm. The
cost of a false response is hours of crew time; the cost of a missed
real event is severe injury or death.
