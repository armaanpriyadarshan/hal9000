# Communications

## Link types

- **S-band** — primary voice and low-rate telemetry. Via TDRSS
  (Tracking and Data Relay Satellite System). Available ~80% of
  the orbit depending on TDRSS satellite positions.
- **Ku-band** — high-rate data, video, payload telemetry. Also via
  TDRSS. Availability similar to S-band.
- **UHF** — EVA comm (suits to station). Line-of-sight only.
- **Russian segment Regul (S-band equivalent)** — primary link to
  Roscosmos Mission Control (MCC-M) in Korolyov, via Russian
  ground stations.

## Ground stations

- **MCC-H (Houston)** — primary flight control for the US segment.
- **MCC-M (Korolyov)** — primary flight control for the Russian
  segment.
- **ESA, JAXA, CSA** — subordinate control centers for their
  respective modules (Columbus, Kibo, etc.), routed through MCC-H.

## Comm windows

- **AOS** (Acquisition of Signal) — station enters a TDRSS
  satellite's coverage; two-way comm available.
- **LOS** (Loss of Signal) — outside TDRSS coverage; no comm until
  next AOS.

LOS gaps are typically a few minutes; rarely more than 10 minutes
in normal operations. Gaps of hours have historically occurred
during TDRSS satellite anomalies.

## During an emergency with LOS

If an emergency occurs during LOS, the crew executes the
memorized procedures without ground support. HAL-type on-device
assistance matters most during LOS.

When AOS returns, the crew reports status and continues working
the problem with ground.

## Voice loops

Operational voice is routed through multiple channels:

- **Space-to-Ground (S/G) 1** — primary loop, station-wide.
- **Space-to-Ground 2** — secondary, crew-to-ground.
- **Internal Space-to-Ground** — crew intercom within the station.

Emergency calls take priority; comm system automatically upgrades
their channel if a conflict exists.

## Role in ammonia emergency

Comm with ground is desired but not required. During LOS, the
crew completes the emergency response independently. Once AOS
returns, the crew reports and receives ground-validated next
steps. HAL / on-device AI fills the LOS gap.
