# Electrical Power System (EPS)

The ISS generates all its electrical power from photovoltaic solar
arrays on the truss, stores it in lithium-ion batteries for the
orbital night portion, and distributes it via a DC primary
distribution network. Nominal end-user voltage on US segment is
120 VDC; Russian segment uses 28 VDC with DC/DC conversion between
segments.

## Generation

- **Solar Array Wings (SAWs)** — 8 wings on the truss (4 on port,
  4 on starboard). Each wing is ~34 m long, two flexible blanket
  sections. Combined generation capacity at beginning of life was
  ~120 kW; current capacity has degraded slightly with age.
- **iROSA (ISS Roll-Out Solar Arrays)** — newer flexible arrays
  installed on top of six of the eight original SAWs. Each iROSA
  adds ~20 kW, so combined add is ~120 kW on top of the legacy
  arrays at their current (degraded) level.
- **Solar Alpha Rotary Joint (SARJ)** and **Beta Gimbal Assembly
  (BGA)** — track the Sun. SARJ rotates full 360° around the
  station's long axis; BGAs tilt each wing for season angle.

## Storage

- **Lithium-ion battery orbital replacement units (ORUs)** on the
  truss. Replaced legacy nickel-hydrogen batteries around 2017–
  2021. Charge during daylight; discharge during eclipse.
- Each orbit has ~35 minutes of eclipse (out of ~93 min orbit).

## Distribution

- **Main Bus Switching Units (MBSUs)** — 4 units, each routing one
  quarter of the primary 160 VDC.
- **Direct Current to Direct Current Converter Units (DDCUs)** —
  step down from ~160 VDC primary to ~120 VDC secondary for end
  users.
- **Remote Power Controllers (RPCs)** — individual circuit
  breakers, addressable by ground or crew for load management.

## Load shedding

During an emergency (ammonia, fire, depress) or during a fault
condition, the crew or ground may shed non-critical loads to
protect the surviving power channels. Typical shed priority:

1. Experiments (first — no life-safety impact).
2. Redundant string of comms/avionics (keep one, drop the other).
3. Secondary lab equipment.
4. Non-critical comms links.

Life support, primary comms, CMG control, lighting, and a minimum
set of avionics are always kept powered.

## Role in ammonia emergency

If the ammonia event forces isolation of an IATCS water loop,
equipment on that loop must be thermally managed. Load shedding
reduces heat generation so the surviving cooling loop can carry
the station through the event. Typical powerdown target: drop
~40% of variable-load equipment to within single-loop thermal
capacity.
