/**
 * Registry of exterior-view ship parts HAL can highlight.
 *
 * The keys of SHIP_PARTS must stay synced with the highlight_part enum
 * in server/tools.py. The server-side pytest asserts the Python-side
 * list; this file is the TypeScript counterpart. Drift = valid tool
 * calls resolve to an undefined entry here and the highlight silently
 * no-ops.
 */

export const CANONICAL_PARTS = [
  "solar_arrays",
  "service_module",
  "p6_truss",
  "s0_truss",
  "external_stowage",
  "ams_experiment",
  "main_modules",
] as const;

export type CanonicalPart = (typeof CANONICAL_PARTS)[number];

export type Match =
  | { kind: "prefix"; values: string[] }
  | { kind: "parent"; values: string[] };

export type PartEntry = {
  displayName: string;
  match: Match;
  cameraOffset: [number, number, number];
  cameraDistanceScale?: number;
};

export const SHIP_PARTS: Record<CanonicalPart, PartEntry> = {
  solar_arrays: {
    displayName: "Solar Arrays",
    match: { kind: "parent", values: ["PAINEIS"] },
    cameraOffset: [1, 0.2, 1],
    cameraDistanceScale: 1.8,
  },
  service_module: {
    displayName: "Zvezda Service Module",
    match: { kind: "prefix", values: ["sm_ext_sm"] },
    cameraOffset: [1, 0.2, 1],
    cameraDistanceScale: 1.8,
  },
  p6_truss: {
    displayName: "P6 Truss",
    match: { kind: "prefix", values: ["p6_ani"] },
    cameraOffset: [1, 0.2, 1],
    cameraDistanceScale: 1.8,
  },
  s0_truss: {
    displayName: "S0 Truss",
    match: { kind: "prefix", values: ["s0_ani"] },
    cameraOffset: [1, 0.2, 1],
    cameraDistanceScale: 1.8,
  },
  external_stowage: {
    displayName: "External Stowage Platforms",
    match: { kind: "prefix", values: ["esp2_lo", "ESP3"] },
    cameraOffset: [1, 0.2, 1],
    cameraDistanceScale: 1.8,
  },
  ams_experiment: {
    displayName: "AMS-2 Experiment",
    match: { kind: "prefix", values: ["AMS2"] },
    cameraOffset: [1, 0.2, 1],
    cameraDistanceScale: 1.8,
  },
  main_modules: {
    displayName: "Main Modules",
    match: { kind: "parent", values: ["MODULO1", "MODULO2"] },
    cameraOffset: [1, 0.2, 1],
    cameraDistanceScale: 1.8,
  },
};

export function isCanonicalPart(v: unknown): v is CanonicalPart {
  return (
    typeof v === "string" &&
    (CANONICAL_PARTS as readonly string[]).includes(v)
  );
}
