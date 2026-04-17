# Communication with Ground During Contingencies

## Nominal comm availability

See `systems/comms.md`. Typically 80–90% of the orbit has
S-band (voice) coverage via TDRSS. LOS gaps are minutes, not
hours, under normal operations.

## Who the crew talks to

- **Capcom (CAPCOM)** — voice loop to Mission Control Houston
  (US segment) or MCC-M Korolyov (Russian segment). Capcom is an
  astronaut; questions go through Capcom to the appropriate flight
  controller.
- **Flight Director (FD)** — overall in charge of the shift at
  Mission Control. Makes go/no-go calls on crew actions.
- **Surgeon (SURG)** — flight surgeon at Mission Control. Crew's
  medical consult for anything beyond the CMO's scope.

## Emergency voice protocol

During an emergency, the crew's first ground call is:

> "Houston, Station. Emergency, [event], standing by."

This triggers Mission Control to clear non-emergency traffic and
bring the flight director to the loop immediately.

Routine radio discipline (callsigns, time hacks) is relaxed
during emergencies; priority is transmission of information
needed to coordinate the response.

## Long-delay scenarios

Deep-space missions (lunar, Mars) have one-way light-time delays
ranging from 1–3 seconds (Moon) to 4–24 minutes (Mars). The
conversational back-and-forth of ISS comm is not possible;
instead, the crew executes procedures autonomously and reports to
ground asynchronously.

HAL is designed for this mode: the crew operates with HAL as the
interactive assistant, and ground receives periodic updates when
comm allows.

## LOS decision-making

When ground is unreachable, the **commander** has full authority.
The commander's decisions stand until comm is restored and ground
either confirms or overrides.

HAL supports the commander's decisions with reference material
retrieval, scenario reasoning, and procedure-walkthrough. HAL
does not make go/no-go decisions on crew safety-critical actions.

## Data downlink during emergency

Most ISS sensor data downlinks continuously via Ku-band. Even
during LOS, data is buffered on-station and dumped at next AOS.
Ground will have full sensor history to review post-event.

Crew should also verbally annotate the voice recorder with
timestamps and decisions during an emergency, to aid in
post-event review.
