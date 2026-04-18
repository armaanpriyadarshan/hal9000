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
  kind: string;
  description: string;
  match: Match;
  cameraOffset: [number, number, number];
  cameraDistanceScale?: number;
};

export const SHIP_PARTS: Record<CanonicalPart, PartEntry> = {
  solar_arrays: {
    displayName: "Solar Arrays",
    kind: "Power Generation",
    description:
      "Eight deployable wings. ~75–90 kW average electrical output; peak ~120 kW in direct sun.",
    match: { kind: "parent", values: ["PAINEIS"] },
    cameraOffset: [1, 0.2, 1],
    cameraDistanceScale: 1.8,
  },
  service_module: {
    displayName: "Zvezda",
    kind: "Service Module",
    description:
      "Russian core module. Primary crew quarters and life-support hub. Habitable since 2000.",
    match: { kind: "prefix", values: ["sm_ext_sm"] },
    cameraOffset: [1, 0.2, 1],
    cameraDistanceScale: 1.8,
  },
  p6_truss: {
    displayName: "P6 Truss",
    kind: "Port-Outboard Truss",
    description:
      "Outermost port truss segment. Carries 2A/4B solar array wings and their thermal radiator.",
    match: { kind: "prefix", values: ["p6_ani"] },
    cameraOffset: [1, 0.2, 1],
    cameraDistanceScale: 1.8,
  },
  s0_truss: {
    displayName: "S0 Truss",
    kind: "Center Truss",
    description:
      "Structural backbone. Anchors the station's module stack and carries the mobile base rails.",
    match: { kind: "prefix", values: ["s0_ani"] },
    cameraOffset: [1, 0.2, 1],
    cameraDistanceScale: 1.8,
  },
  external_stowage: {
    displayName: "External Stowage",
    kind: "ESP-2 / ESP-3",
    description:
      "External platforms holding orbital-replacement units — spare tanks, batteries, and pumps.",
    match: { kind: "prefix", values: ["esp2_lo", "ESP3"] },
    cameraOffset: [1, 0.2, 1],
    cameraDistanceScale: 1.8,
  },
  ams_experiment: {
    displayName: "AMS-2",
    kind: "Alpha Magnetic Spectrometer",
    description:
      "Cosmic-ray detector mounted on the S3 truss. Studies dark matter and antimatter; online since 2011.",
    match: { kind: "prefix", values: ["AMS2"] },
    cameraOffset: [1, 0.2, 1],
    cameraDistanceScale: 1.8,
  },
  main_modules: {
    displayName: "Main Modules",
    kind: "Pressurised Cluster",
    description:
      "Primary habitable stack — Destiny, Unity, Harmony, Columbus, Kibo. Crew work and sleep spaces.",
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
