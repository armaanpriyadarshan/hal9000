/**
 * Catalog of NASA ISS Live telemetry PUIs we subscribe to via Lightstreamer.
 *
 * PUI = Program Unique Identifier, the item names NASA uses in the public
 * push feed served at push.lightstreamer.com (adapter ISSLIVE, no auth).
 *
 * Values arrive as strings. Each PUI has a converter that parses the raw
 * string, optionally strips a trailing unit suffix, and applies any unit
 * conversion we want applied before display. Callers format further
 * (decimals, padding) per row.
 */

export type PuiId =
  | "TIME_000001"
  | "USLAB000058"
  | "USLAB000059"
  | "USLAB000053"
  | "USLAB000055"
  | "NODE3000001"
  | "NODE3000003"
  | "NODE3000010"
  | "NODE3000008"
  | "NODE3000009"
  | "S4000002"
  | "P4000001"
  | "S0000003"
  | "USLAB000010"
  | "USLAB000022"
  | "USLAB000023"
  | "USLAB000024"
  | "USLAB000040";

export type PuiValue = {
  value: string;
  timestamp: string;
  status: string | null;
  /** performance.now() at receipt — used to detect stale. */
  receivedAt: number;
};

/** Strip known unit suffixes from raw PUI strings before parsing. */
function toNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const stripped = raw.replace(/[a-zA-Z°%/]+$/g, "").trim();
  const n = Number.parseFloat(stripped);
  return Number.isFinite(n) ? n : null;
}

const PSI_TO_KPA = 6.894_757_293_168_36;

export function psiToKpa(psi: number): number {
  return psi * PSI_TO_KPA;
}

export function fahrenheitToCelsius(f: number): number {
  return ((f - 32) * 5) / 9;
}

/**
 * ppO₂ arrives from USLAB000053 in psia. Convert to approximate volume
 * percent assuming total cabin pressure ~14.7 psia. Not a perfect
 * substitute for a real pO₂/P_total ratio but readable enough for a
 * monitoring HUD.
 */
export function ppO2ToPercent(psia: number, cabinPressPsia = 14.7): number {
  return (psia / cabinPressPsia) * 100;
}

/**
 * ppCO₂ arrives from USLAB000055 in psia. Convert to ppm assuming
 * CO₂ partial pressure → mole fraction × 1e6 of total pressure.
 */
export function ppCo2ToPpm(psia: number, cabinPressPsia = 14.7): number {
  return (psia / cabinPressPsia) * 1_000_000;
}

/** Display metadata per subscribed PUI. */
export type PuiMeta = {
  /** Human label for the HUD row. */
  label: string;
  /** Which section the row belongs to. */
  section: "time" | "ECLSS" | "EPS" | "ADCS";
  /** Parse raw string → display-ready number. Null when unparsable. */
  parse: (raw: string | undefined) => number | null;
  /** Suffix rendered after the value. */
  unit?: string;
  /** Fractional digits when formatting (default 2). */
  digits?: number;
};

export const PUI_META: Record<PuiId, PuiMeta> = {
  TIME_000001: {
    label: "GMT",
    section: "time",
    parse: (raw) => toNumber(raw),
  },
  USLAB000058: {
    label: "CABIN PRESS.",
    section: "ECLSS",
    parse: (raw) => {
      const psi = toNumber(raw);
      return psi === null ? null : psiToKpa(psi);
    },
    unit: "KPA",
    digits: 1,
  },
  USLAB000059: {
    label: "CABIN TEMP",
    section: "ECLSS",
    parse: (raw) => {
      const f = toNumber(raw);
      return f === null ? null : fahrenheitToCelsius(f);
    },
    unit: "°C",
    digits: 1,
  },
  USLAB000053: {
    label: "ppO₂",
    section: "ECLSS",
    parse: (raw) => {
      const psi = toNumber(raw);
      return psi === null ? null : ppO2ToPercent(psi);
    },
    unit: "%",
    digits: 2,
  },
  USLAB000055: {
    label: "ppCO₂",
    section: "ECLSS",
    parse: (raw) => {
      const psi = toNumber(raw);
      return psi === null ? null : ppCo2ToPpm(psi);
    },
    unit: "PPM",
    digits: 0,
  },
  NODE3000001: {
    label: "NODE 3 ppO₂",
    section: "ECLSS",
    parse: (raw) => {
      const psi = toNumber(raw);
      return psi === null ? null : ppO2ToPercent(psi);
    },
    unit: "%",
    digits: 2,
  },
  NODE3000003: {
    label: "NODE 3 ppCO₂",
    section: "ECLSS",
    parse: (raw) => {
      const psi = toNumber(raw);
      return psi === null ? null : ppCo2ToPpm(psi);
    },
    unit: "PPM",
    digits: 0,
  },
  NODE3000010: {
    label: "O₂ GEN.",
    section: "ECLSS",
    parse: (raw) => toNumber(raw),
    digits: 0,
  },
  NODE3000008: {
    label: "WASTE H₂O",
    section: "ECLSS",
    parse: (raw) => toNumber(raw),
    unit: "%",
    digits: 0,
  },
  NODE3000009: {
    label: "POTABLE H₂O",
    section: "ECLSS",
    parse: (raw) => toNumber(raw),
    unit: "%",
    digits: 0,
  },
  S4000002: {
    label: "ARRAY 1A CURR.",
    section: "EPS",
    parse: (raw) => toNumber(raw),
    unit: "A",
    digits: 1,
  },
  P4000001: {
    label: "ARRAY 2A VOLT.",
    section: "EPS",
    parse: (raw) => toNumber(raw),
    unit: "V",
    digits: 1,
  },
  S0000003: {
    label: "SARJ STBD",
    section: "EPS",
    parse: (raw) => toNumber(raw),
    unit: "°",
    digits: 1,
  },
  USLAB000010: {
    label: "CMG MOMENTUM",
    section: "ADCS",
    parse: (raw) => toNumber(raw),
    unit: "%",
    digits: 0,
  },
  USLAB000022: {
    label: "ROLL ERR",
    section: "ADCS",
    parse: (raw) => toNumber(raw),
    unit: "°",
    digits: 2,
  },
  USLAB000023: {
    label: "PITCH ERR",
    section: "ADCS",
    parse: (raw) => toNumber(raw),
    unit: "°",
    digits: 2,
  },
  USLAB000024: {
    label: "YAW ERR",
    section: "ADCS",
    parse: (raw) => toNumber(raw),
    unit: "°",
    digits: 2,
  },
  USLAB000040: {
    label: "SOLAR BETA",
    section: "ADCS",
    parse: (raw) => toNumber(raw),
    unit: "°",
    digits: 1,
  },
};

export const SUBSCRIBED_PUIS: readonly PuiId[] = Object.keys(PUI_META) as PuiId[];

/**
 * Format a parsed numeric value for display. Returns the em-dash fallback
 * when the parsed value is null (not yet received, or unparsable).
 */
export function formatPuiValue(puiId: PuiId, parsed: number | null): string {
  const meta = PUI_META[puiId];
  if (parsed === null || !Number.isFinite(parsed)) {
    return meta.unit ? `—— ${meta.unit}` : "——";
  }
  const digits = meta.digits ?? 2;
  const formatted = parsed.toFixed(digits);
  return meta.unit ? `${formatted} ${meta.unit}` : formatted;
}

/**
 * Shorthand to read + parse a PUI in one call from a values map returned
 * by useIssLightstreamer.
 */
export function readPui(
  values: Partial<Record<PuiId, PuiValue>>,
  puiId: PuiId,
): number | null {
  const entry = values[puiId];
  if (!entry) return null;
  return PUI_META[puiId].parse(entry.value);
}
