# Caution & Warning (C&W) Alarm Taxonomy

The ISS Caution & Warning system classifies every alarm into one of
four priorities. Each priority has a distinct audio tone and visual
annunciation. Crew response is priority-driven: higher priorities
preempt lower ones.

## Priority levels

### 1. Emergency — the "big three"

Three emergency categories, each with its own dedicated tone:

- **Fire** — continuous siren. Triggered by smoke detectors or
  visible flame / thermal sensor excursion.
- **Rapid depressurization (ΔP)** — warbling tone. Triggered by
  cabin pressure drop rate exceeding ~1 mmHg/min sustained.
- **Atmosphere (ATM)** — fast beeping tone. Triggered by toxic
  atmosphere detection (ammonia, combustion byproducts, other
  hazardous gases).

Every emergency annunciation triggers **both** the audio alarm and
the visual annunciator on all C&W panels station-wide. No module is
excluded.

Crew response for all three emergencies is coordinated through the
Commander and follows memorized immediate-action procedures. These
are the only situations that justify unplanned hatch closure between
modules.

### 2. Warning — "deep yellow"

Non-emergency but requires prompt crew action. Examples:

- Loss of a redundant avionics unit with single point of failure
  exposure.
- Temperature excursion approaching equipment limit.
- Caution channels that have been upgraded due to cumulative
  conditions.

Crew action window: minutes to tens of minutes.

### 3. Caution — "yellow"

Off-nominal condition, crew or ground to assess and respond. No
immediate safety concern. Examples:

- Single CDRA degraded.
- Experiment rack fault.
- Single string failure on a redundant system.

Crew action window: hours.

### 4. Advisory

Informational; logged, not requiring active crew response. Examples:

- Scheduled reboost starting.
- Communication pass with ground beginning/ending.

## Response overview

Every alarm is first acknowledged (silenced) to stop the audio, then
investigated via the associated caution & warning panel display
which identifies the specific channel that tripped. The commander
decides whether to proceed with standard response (emergency
procedures are pre-briefed) or consult Mission Control (for
non-emergency alarms, if comm is available).

Multiple simultaneous alarms are possible and common. The crew
handles the highest-priority alarm first. An emergency alarm
preempts any non-emergency activity in progress.
