/**
 * Registry of interior-view modules HAL can teleport the camera to.
 *
 * The keys of INTERIOR_AREAS must stay synced with the navigate_to enum
 * in server/tools.py. Drift = valid tool calls resolve to an undefined
 * entry here and the teleport silently no-ops.
 *
 * `glbNodeName` values are post-sanitiser: three.js's GLTFLoader strips
 * `.` and other reserved chars from glTF node names via
 * PropertyBinding.sanitizeNodeName, so `US_Lab.CenterOfNodeForRoulette`
 * in the glb resolves as `US_LabCenterOfNodeForRoulette` on the loaded
 * scene.
 */

export const CANONICAL_AREAS = [
  "pmm",
  "unity",
  "harmony",
  "tranquility",
  "cupola",
  "destiny",
  "columbus",
  "kibo_jpm",
  "kibo_jlp",
  "airlock",
] as const;

export type CanonicalArea = (typeof CANONICAL_AREAS)[number];

export type AreaEntry = {
  displayName: string;
  kind: string;
  description: string;
  glbNodeName: string;
};

export const INTERIOR_AREAS: Record<CanonicalArea, AreaEntry> = {
  pmm: {
    displayName: "PMM (Leonardo)",
    kind: "Stowage Module",
    description:
      "Permanent Multipurpose Module. Converted Italian cargo module; primary on-station stowage volume since 2011.",
    glbNodeName: "PMM",
  },
  unity: {
    displayName: "Unity (Node 1)",
    kind: "Utility Node",
    description:
      "First US node. Central junction connecting Destiny, Tranquility, the Airlock, and the Russian segment.",
    glbNodeName: "Node1",
  },
  harmony: {
    displayName: "Harmony (Node 2)",
    kind: "Utility Node",
    description:
      "Forward node. Connects Destiny to Columbus and Kibo; hosts international crew quarters and docking ports for Crew Dragon.",
    glbNodeName: "Node2",
  },
  tranquility: {
    displayName: "Tranquility (Node 3)",
    kind: "Life-Support Node",
    description:
      "Life-support hub. Houses the ECLSS water-recovery rack, the WHC toilet, the Cupola, and the PMM.",
    glbNodeName: "Node3",
  },
  cupola: {
    displayName: "Cupola",
    kind: "Observation Dome",
    description:
      "Seven-window observation module under Tranquility. Also the Canadarm2 robotic workstation.",
    glbNodeName: "Cupola",
  },
  destiny: {
    displayName: "Destiny (US Lab)",
    kind: "US Laboratory",
    description:
      "Primary US research module. Hosts the main station command workstation and most US scientific racks.",
    glbNodeName: "US_LabCenterOfNodeForRoulette",
  },
  columbus: {
    displayName: "Columbus",
    kind: "ESA Laboratory",
    description:
      "European research module. Hosts ESA biology, fluids, and materials-science experiments.",
    glbNodeName: "Columbus",
  },
  kibo_jpm: {
    displayName: "Kibo JPM",
    kind: "Japanese Laboratory",
    description:
      "Japanese Pressurised Module — largest single non-Russian module on the station. JAXA research and Exposed Facility hub.",
    glbNodeName: "JPM",
  },
  kibo_jlp: {
    displayName: "Kibo JLP",
    kind: "Logistics Module",
    description:
      "Japanese Experiment Logistics Module. Pressurised attic above the JPM; on-station storage for Kibo hardware.",
    glbNodeName: "JLP",
  },
  airlock: {
    displayName: "Quest Airlock",
    kind: "EVA Prep",
    description:
      "US airlock. Crew-lock and equipment-lock volumes; primary egress for US-segment spacewalks since 2001.",
    glbNodeName: "Airlock_Int_Sys",
  },
};

export function isCanonicalArea(v: unknown): v is CanonicalArea {
  return (
    typeof v === "string" &&
    (CANONICAL_AREAS as readonly string[]).includes(v)
  );
}
