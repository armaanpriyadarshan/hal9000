/**
 * Registry of interior-view modules HAL can navigate the camera to.
 *
 * The keys of INTERIOR_AREAS must stay synced with the navigate_to enum
 * in server/tools.py. Drift = valid tool calls resolve to an undefined
 * entry here and the navigation silently no-ops.
 *
 * ADJACENCY encodes the real ISS topology between pressurised modules.
 * HATCH_HINT maps each edge to the glb hatch node name at the midpoint
 * of the crossing, so the camera flies through hatch centres rather
 * than straight through bulkheads.
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
    glbNodeName: "US_Lab.CenterOfNodeForRoulette",
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
      "Japanese Pressurised Module — largest single habitable module on the station. JAXA research and Exposed Facility hub.",
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

export const ADJACENCY: Record<CanonicalArea, CanonicalArea[]> = {
  pmm:         ["tranquility"],
  tranquility: ["pmm", "unity", "cupola"],
  cupola:      ["tranquility"],
  unity:       ["tranquility", "airlock", "destiny"],
  airlock:     ["unity"],
  destiny:     ["unity", "harmony"],
  harmony:     ["destiny", "columbus", "kibo_jpm"],
  columbus:    ["harmony"],
  kibo_jpm:    ["harmony", "kibo_jlp"],
  kibo_jlp:    ["kibo_jpm"],
};

/**
 * Directional hatch-node name hint for each adjacency edge.
 *
 * Lookup is undirected — if "A→B" is missing, try "B→A". Values are
 * glb node names dumped from iss-interior.glb; if a hint is wrong the
 * flight falls back to the midpoint of the two module bounding-box
 * centres (see ISSInteriorScene).
 */
export const HATCH_HINT: Record<string, string> = {
  "unity→destiny":       "Node1_Int_Hub.FWD",
  "unity→tranquility":   "Node1_Int_Hub.PRT",
  "unity→airlock":       "Node1_Int_Hub.SBD",
  "tranquility→cupola":  "Node3_Int_Hub.NDR",
  "tranquility→pmm":     "Node3_Int_Hub.FWD",
  "destiny→harmony":     "Node2_Int_Hub.AFT",
  "harmony→columbus":    "Node2_Int_Hub.SBD",
  "harmony→kibo_jpm":    "Node2_Int_Hub.PRT",
  "kibo_jpm→kibo_jlp":   "JLP_Metal_Hatch_Nadir",
};

export function isCanonicalArea(v: unknown): v is CanonicalArea {
  return (
    typeof v === "string" &&
    (CANONICAL_AREAS as readonly string[]).includes(v)
  );
}

/**
 * Shortest-path traversal through the adjacency graph. Returns the full
 * chain including `from` and `to`, or null if unreachable (shouldn't
 * happen with the hand-authored graph, but guards against future typos).
 */
export function bfs(
  from: CanonicalArea,
  to: CanonicalArea,
): CanonicalArea[] | null {
  if (from === to) return [from];
  const visited = new Set<CanonicalArea>([from]);
  const queue: { node: CanonicalArea; path: CanonicalArea[] }[] = [
    { node: from, path: [from] },
  ];
  while (queue.length > 0) {
    const { node, path } = queue.shift()!;
    for (const next of ADJACENCY[node]) {
      if (visited.has(next)) continue;
      const nextPath = [...path, next];
      if (next === to) return nextPath;
      visited.add(next);
      queue.push({ node: next, path: nextPath });
    }
  }
  return null;
}
