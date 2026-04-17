# Oxygen Generation Assembly (OGA)

OGA produces oxygen for the cabin by electrolyzing water. Located
in Node 3. Works with the Russian Elektron (similar function, in
Zvezda) for redundancy.

## Principle

Water (from the Water Processing Assembly) is fed into an
electrolyzer cell stack. Applied voltage splits H₂O into O₂ and H₂.
Oxygen is vented to the cabin. Hydrogen is either vented overboard
or routed to the Sabatier reactor.

## Specs

- Nominal output: ~5.5 kg O₂/day (supports ~5–6 crew at nominal
  metabolic rate).
- Max output: ~9 kg O₂/day.
- Water consumption: ~1.1 L of water per kg of O₂ produced.
- Power: ~1.5 kW at nominal output.

## Sabatier reactor

Co-located with OGA. Takes hydrogen from OGA plus CO₂ from CDRA and
combines them catalytically to produce water and methane:

    CO₂ + 4H₂ → CH₄ + 2H₂O

The water goes back to WPA (closes part of the water loop). Methane
is vented overboard.

Sabatier recovery reduces the ISS's net water import by ~50%.

## Failure modes

- **Electrolyzer stack degradation** — slow capacity loss over
  years; replaceable on-orbit.
- **Water feed fault** — loss of water supply halts oxygen
  generation immediately. Backup oxygen from Elektron or high-
  pressure tanks.
- **Hydrogen outgassing** — catastrophic failure mode if H₂
  accumulates in cabin. Monitored by MCA; automatic OGA shutdown
  on H₂ concentration rise.

## Emergency backup oxygen

If both OGA and Elektron fail:

1. **Solid Fuel Oxygen Generators (SFOGs)** — chemical candles
   that release O₂ on activation. Each burns for ~30 minutes
   releasing ~600 L of O₂. Stowage holds days of crew supply.
2. **High-pressure O₂ tanks** — on the airlock, primary purpose
   EVA prebreathe but usable as emergency cabin supply.
3. **Stored compressed air** — the station cabin volume plus
   makeup gas reserves gives the crew ~several days of O₂
   consumption without any generation.

## Role in ammonia emergency

OGA is taken offline during an ammonia event to protect the
electrolyzer stack from contamination. Cabin O₂ drops slowly via
crew consumption; makeup from stored reserves or restart once
atmosphere is clean.
