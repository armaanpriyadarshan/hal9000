# Interior Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `navigate_to(area)` tool that flies the interior camera through the ISS along a path of hatches to one of 10 pressurised modules, with an exterior-style caption (top banner + draggable info card) announcing the arrival.

**Architecture:** Server registers a third tool (`navigate_to`) with a 10-entry enum of canonical area names. Client owns an area registry (`interiorAreas.ts`) mapping canonical names to glb node names, an adjacency graph of hatch connections, and directional hatch-node hints. A client-side handler navigates to `/?area=<canonical>&t=<nonce>`. `ISSInteriorScene` reads the URL, plans a BFS path through the adjacency graph, builds a waypoint list (origin → hatch → module → hatch → … → target), and lerps the camera segment-by-segment with look-ahead targeting. `InteriorCaption` renders the top banner + draggable card as DOM overlays outside the Canvas.

**Tech Stack:** Python + FastAPI + Cactus (server, existing). Next.js 16 App Router + React 19 + `@react-three/fiber` + `@react-three/drei` + `three` (client, existing). No new dependencies.

**Spec reference:** `docs/superpowers/specs/2026-04-18-interior-navigation-design.md`

---

## File Structure

**Create:**
- `client/src/lib/interiorAreas.ts` — registry of 10 pressurised modules: canonical name → `displayName`, `kind`, `description`, `glbNodeName`. Also exports `CANONICAL_AREAS`, `ADJACENCY`, `HATCH_HINT`, `isCanonicalArea`, `bfs`.
- `client/src/components/InteriorCaption.tsx` — two DOM overlays: top-center "NOW AT …" banner + bottom-right draggable info card. Reuses existing `DraggableCaption` primitive.

**Modify:**
- `server/tools.py` — append `navigate_to` `ToolSpec` to `TOOL_SPECS`.
- `server/tests/test_tools.py` — add 2 tests (registration + description-alias sanity).
- `server/config.py` — extend `SYSTEM_PROMPT` with a paragraph about `navigate_to`.
- `client/src/lib/halTools.ts` — add `navigate_to` handler that `router.push`es to `/?area=<canonical>&t=<nonce>`.
- `client/src/components/ISSInteriorScene.tsx` — full rewrite of the flight logic: read URL search param, plan BFS path, build waypoint list, lerp camera via `useFrame` with look-ahead targeting. Preserves existing lighting, Environment preset, material conversion, OrbitControls configuration.
- `client/src/app/page.tsx` — mount `<InteriorCaption />` alongside the scene.

---

### Task 1: Register `navigate_to` in `TOOL_SPECS` + tests

**Files:**
- Modify: `server/tools.py`
- Modify: `server/tests/test_tools.py`

- [ ] **Step 1: Write failing tests for the new spec**

Append to `server/tests/test_tools.py`:

```python
EXPECTED_NAVIGATE_TO_ENUM = [
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
]


def test_navigate_to_is_registered():
    spec = next((s for s in TOOL_SPECS if s.name == "navigate_to"), None)
    assert spec is not None, "navigate_to missing from TOOL_SPECS"
    assert spec.location == "client"
    assert spec.parameters["required"] == ["area"]
    enum = spec.parameters["properties"]["area"]["enum"]
    assert list(enum) == EXPECTED_NAVIGATE_TO_ENUM


def test_navigate_to_description_covers_every_canonical_name():
    spec = next((s for s in TOOL_SPECS if s.name == "navigate_to"), None)
    assert spec is not None
    for name in EXPECTED_NAVIGATE_TO_ENUM:
        assert name in spec.description, f"canonical name {name!r} missing from description"


def test_dispatch_valid_navigate_to_returns_directive_and_ack():
    calls = [{"name": "navigate_to", "arguments": {"area": "cupola"}}]
    result = dispatch(calls)
    assert result.ack_text == "Navigating to the cupola."
    assert result.client_directives == [
        {"name": "navigate_to", "arguments": {"area": "cupola"}}
    ]
    assert result.failed_calls == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```
cd server && .venv/bin/python -m pytest tests/test_tools.py::test_navigate_to_is_registered -v
```

Expected: `assert spec is not None` → fails because `navigate_to` hasn't been registered.

- [ ] **Step 3: Register `navigate_to` in `server/tools.py`**

Append a third `ToolSpec` entry inside `TOOL_SPECS` (after the `highlight_part` entry):

```python
    ToolSpec(
        name="navigate_to",
        description=(
            "Fly the interior camera through the station to one of the "
            "pressurised modules. Camera-only — no mesh highlighting. "
            "Auto-switches to the interior view if the crew is currently "
            "outside, so you do NOT need to call set_view first. Map the "
            "crew's natural phrasing to one of the canonical names below:\n"
            "- pmm — PMM, Leonardo, Permanent Multipurpose Module, stowage module\n"
            "- unity — Unity, Node 1, central node\n"
            "- harmony — Harmony, Node 2, forward node\n"
            "- tranquility — Tranquility, Node 3, life-support node\n"
            "- cupola — Cupola, observation dome, the window\n"
            "- destiny — Destiny, US Lab, US Laboratory, main lab\n"
            "- columbus — Columbus, ESA lab, European lab\n"
            "- kibo_jpm — Kibo, JPM, Japanese Pressurised Module, main Japanese lab\n"
            "- kibo_jlp — JLP, Kibo Logistics, Japanese Experiment Logistics Module, Kibo attic\n"
            "- airlock — Quest, airlock, EVA prep, spacewalk prep"
        ),
        parameters={
            "type": "object",
            "properties": {
                "area": {
                    "type": "string",
                    "enum": [
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
                    ],
                    "description": "Canonical name of the module to fly to.",
                },
            },
            "required": ["area"],
        },
        location="client",
        ack_template="Navigating to the {area}.",
    ),
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```
cd server && .venv/bin/python -m pytest tests/test_tools.py -v
```

Expected: all tests pass (the three new ones plus the existing suite).

- [ ] **Step 5: Commit**

```bash
git add server/tools.py server/tests/test_tools.py
git commit -m "Register navigate_to tool with 10-module enum"
```

---

### Task 2: Extend `SYSTEM_PROMPT` with `navigate_to` catalog

**Files:**
- Modify: `server/config.py`

- [ ] **Step 1: Append `navigate_to` section to the Tools Available block**

In `server/config.py`, locate the block that starts with `"Tools available to you:\n"`. After the `main_modules:` line of entry #2 (`highlight_part`), add entry #3.

Find:
```python
    "   - main_modules: main modules, habitable modules, pressurised "
    "modules, crew modules, Destiny, Unity, Harmony, Columbus, Kibo\n"
    "\n"
    "Prefer invoking a tool over describing the change in prose. If "
```

Replace with:
```python
    "   - main_modules: main modules, habitable modules, pressurised "
    "modules, crew modules, Destiny, Unity, Harmony, Columbus, Kibo\n"
    "\n"
    "3. navigate_to — fly the interior camera through the station to "
    "one of the pressurised modules. Auto-switches to the interior "
    "view if needed, so you do NOT need to call set_view first. "
    "Camera-only — use highlight_part for the exterior. Accepts one "
    "of these canonical names; map the crew's natural phrasing to the "
    "closest match:\n"
    "   - pmm: PMM, Leonardo, Permanent Multipurpose Module, stowage "
    "module\n"
    "   - unity: Unity, Node 1, central node\n"
    "   - harmony: Harmony, Node 2, forward node\n"
    "   - tranquility: Tranquility, Node 3, life-support node\n"
    "   - cupola: Cupola, observation dome, the window\n"
    "   - destiny: Destiny, US Lab, US Laboratory, main lab\n"
    "   - columbus: Columbus, ESA lab, European lab\n"
    "   - kibo_jpm: Kibo, JPM, Japanese Pressurised Module, main "
    "Japanese lab\n"
    "   - kibo_jlp: JLP, Kibo Logistics, Japanese Experiment Logistics "
    "Module, Kibo attic\n"
    "   - airlock: Quest, airlock, EVA prep, spacewalk prep\n"
    "\n"
    "Prefer invoking a tool over describing the change in prose. If "
```

- [ ] **Step 2: Smoke-check the prompt loads**

Run:
```
cd server && .venv/bin/python -c "from config import SYSTEM_PROMPT; assert 'navigate_to' in SYSTEM_PROMPT; assert 'kibo_jpm' in SYSTEM_PROMPT; print('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add server/config.py
git commit -m "Add navigate_to catalog to SYSTEM_PROMPT"
```

---

### Task 3: Build `client/src/lib/interiorAreas.ts`

**Files:**
- Create: `client/src/lib/interiorAreas.ts`

- [ ] **Step 1: Create the file**

Write `client/src/lib/interiorAreas.ts`:

```typescript
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
```

- [ ] **Step 2: Type-check**

Run:
```
cd client && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/lib/interiorAreas.ts
git commit -m "Add interiorAreas registry with adjacency + hatch hints"
```

---

### Task 4: Add `navigate_to` handler to `halTools.ts`

**Files:**
- Modify: `client/src/lib/halTools.ts`

- [ ] **Step 1: Add the handler**

In `client/src/lib/halTools.ts`, find the `CLIENT_TOOLS` object:

```typescript
const CLIENT_TOOLS: Record<string, Handler> = {
  set_view: (args, { router }) => {
    const view = typeof args.view === "string" ? args.view : "";
    if (view === "exterior") router.push("/exterior");
    else if (view === "interior") router.push("/");
  },
  highlight_part: (args, { router }) => {
    const part = typeof args.part === "string" ? args.part : "";
    if (!part) return;
    // Append a nonce so repeat calls with the same part still change the
    // URL and retrigger the scene's highlight effect (camera lerp + label).
    // The scene reads only `highlight`, ignoring `t`.
    router.push(
      `/exterior?highlight=${encodeURIComponent(part)}&t=${Date.now().toString(36)}`,
    );
  },
};
```

Replace with:
```typescript
const CLIENT_TOOLS: Record<string, Handler> = {
  set_view: (args, { router }) => {
    const view = typeof args.view === "string" ? args.view : "";
    if (view === "exterior") router.push("/exterior");
    else if (view === "interior") router.push("/");
  },
  highlight_part: (args, { router }) => {
    const part = typeof args.part === "string" ? args.part : "";
    if (!part) return;
    // Append a nonce so repeat calls with the same part still change the
    // URL and retrigger the scene's highlight effect (camera lerp + label).
    // The scene reads only `highlight`, ignoring `t`.
    router.push(
      `/exterior?highlight=${encodeURIComponent(part)}&t=${Date.now().toString(36)}`,
    );
  },
  navigate_to: (args, { router }) => {
    const area = typeof args.area === "string" ? args.area : "";
    if (!area) return;
    // Nonce mirrors highlight_part — repeat navigations to the same
    // area retrigger the scene's flight effect.
    router.push(
      `/?area=${encodeURIComponent(area)}&t=${Date.now().toString(36)}`,
    );
  },
};
```

- [ ] **Step 2: Type-check**

Run:
```
cd client && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/lib/halTools.ts
git commit -m "Add navigate_to client-side handler"
```

---

### Task 5: Rewrite `ISSInteriorScene.tsx` with waypoint flight

**Files:**
- Modify: `client/src/components/ISSInteriorScene.tsx`

This task is the heart of the feature. The existing file sets up Canvas, lighting, material conversion, and OrbitControls. We preserve all of that and add:

1. Reading `?area=` from the URL via `useSearchParams`.
2. A `useMemo` on `scene` that builds a map `CanonicalArea → { center: THREE.Vector3 }` via `THREE.Box3.setFromObject`. Computed once per scene load so every nav is cheap.
3. A flight ref + `useEffect` keyed on `[scene, area]` that plans the flight: resolves origin (`originRef` if set, else walk the area list and find the module whose bbox contains `camera.position`, else default-pose fallback), runs `bfs(origin, target)`, builds waypoints by alternating module centre → hatch centre → module centre, and writes `flightRef.current`.
4. A `useFrame` that advances the current segment, eases, `lerpVectors` into `camera.position`, `lookAt` the waypoint two ahead, and clears `flightRef` when done.
5. On `area === null`, a single-segment flight back to the startup pose.

- [ ] **Step 1: Replace the full file contents**

Overwrite `client/src/components/ISSInteriorScene.tsx` with:

```typescript
"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF, Environment } from "@react-three/drei";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import {
  CANONICAL_AREAS,
  HATCH_HINT,
  INTERIOR_AREAS,
  bfs,
  isCanonicalArea,
  type CanonicalArea,
} from "@/lib/interiorAreas";

const CAMERA_POSITION: [number, number, number] = [55.214, -0.95, -33.493];
// Rotated 90° right (clockwise around Y) from the original -Z heading.
const CAMERA_TARGET: [number, number, number] = [54.214, -0.95, -33.493];

const SEGMENT_MS = 500;

type Flight = {
  waypoints: THREE.Vector3[];
  startedAt: number;
  segmentMs: number;
};

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function Model() {
  const { scene } = useGLTF("/iss-interior.glb");

  useEffect(() => {
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((mat, i) => {
        if (!(mat instanceof THREE.MeshBasicMaterial)) return;
        const standard = new THREE.MeshStandardMaterial({
          map: mat.map,
          color: mat.color,
          side: mat.side,
          transparent: mat.transparent,
          opacity: mat.opacity,
          roughness: 0.5,
          metalness: 0.4,
        });
        if (Array.isArray(child.material)) {
          child.material[i] = standard;
        } else {
          child.material = standard;
        }
        mat.dispose();
      });
    });
  }, [scene]);

  return <primitive object={scene} />;
}

function FlightController({ area }: { area: CanonicalArea | null }) {
  const { camera } = useThree();
  const { scene: gltfScene } = useGLTF("/iss-interior.glb");

  const flightRef = useRef<Flight | null>(null);
  const originRef = useRef<CanonicalArea | null>(null);

  // Memoise area → world-space bounding-box centre once per glb load.
  // Skips areas whose glb node can't be found (logs a warning).
  const areaCenters = useMemo(() => {
    const map = new Map<CanonicalArea, THREE.Vector3>();
    for (const key of CANONICAL_AREAS) {
      const entry = INTERIOR_AREAS[key];
      const node = gltfScene.getObjectByName(entry.glbNodeName);
      if (!node) {
        console.warn(`[interior] missing glb node for ${key}: ${entry.glbNodeName}`);
        continue;
      }
      const box = new THREE.Box3().setFromObject(node);
      map.set(key, box.getCenter(new THREE.Vector3()));
    }
    return map;
  }, [gltfScene]);

  // Resolve origin for a new flight: prefer the last-targeted area, else
  // the module whose bbox contains the current camera position, else the
  // default startup module (whichever contains CAMERA_POSITION).
  const resolveOrigin = (): CanonicalArea | null => {
    if (originRef.current) return originRef.current;
    const pos = camera.position;
    for (const key of CANONICAL_AREAS) {
      const entry = INTERIOR_AREAS[key];
      const node = gltfScene.getObjectByName(entry.glbNodeName);
      if (!node) continue;
      const box = new THREE.Box3().setFromObject(node);
      if (box.containsPoint(pos)) return key;
    }
    return null;
  };

  // Look up the hatch node for an edge in either direction, returning its
  // world-space bounding-box centre. Falls back to the midpoint of the
  // two module centres if the hint is missing or the node can't be found.
  const resolveHatchCenter = (
    a: CanonicalArea,
    b: CanonicalArea,
  ): THREE.Vector3 => {
    const hint = HATCH_HINT[`${a}→${b}`] ?? HATCH_HINT[`${b}→${a}`];
    if (hint) {
      const node = gltfScene.getObjectByName(hint);
      if (node) {
        return new THREE.Box3().setFromObject(node).getCenter(new THREE.Vector3());
      }
      console.warn(`[interior] hatch node not found: ${hint}`);
    }
    const cA = areaCenters.get(a);
    const cB = areaCenters.get(b);
    if (cA && cB) return cA.clone().add(cB).multiplyScalar(0.5);
    return new THREE.Vector3();
  };

  // Plan a flight whenever `area` changes.
  useEffect(() => {
    if (area === null) {
      // Clear: single-segment lerp back to the startup pose.
      flightRef.current = {
        waypoints: [
          camera.position.clone(),
          new THREE.Vector3(...CAMERA_POSITION),
        ],
        startedAt: performance.now(),
        segmentMs: SEGMENT_MS,
      };
      originRef.current = null;
      return;
    }

    const target = area;
    const origin = resolveOrigin();

    const targetCenter = areaCenters.get(target);
    if (!targetCenter) {
      console.warn(`[interior] target module has no center: ${target}`);
      return;
    }

    let waypoints: THREE.Vector3[];
    if (origin === null || origin === target) {
      // Cold start or same-module nav: single-segment lerp into the target.
      waypoints = [camera.position.clone(), targetCenter.clone()];
    } else {
      const chain = bfs(origin, target);
      if (!chain) {
        console.warn(`[interior] no path from ${origin} to ${target}`);
        return;
      }
      waypoints = [camera.position.clone()];
      for (let i = 0; i < chain.length - 1; i++) {
        waypoints.push(resolveHatchCenter(chain[i], chain[i + 1]));
        waypoints.push(areaCenters.get(chain[i + 1])!.clone());
      }
    }

    flightRef.current = {
      waypoints,
      startedAt: performance.now(),
      segmentMs: SEGMENT_MS,
    };
    originRef.current = target;
  // We intentionally omit camera + gltfScene + areaCenters — those are
  // stable (or captured via refs) and re-running the plan on their
  // identity change would cause jittery re-plans.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area]);

  useFrame(() => {
    const flight = flightRef.current;
    if (!flight) return;

    const elapsed = performance.now() - flight.startedAt;
    const segmentCount = flight.waypoints.length - 1;
    const totalMs = segmentCount * flight.segmentMs;

    if (elapsed >= totalMs) {
      const last = flight.waypoints[flight.waypoints.length - 1];
      camera.position.copy(last);
      camera.lookAt(last);
      flightRef.current = null;
      return;
    }

    const segIndex = Math.min(
      segmentCount - 1,
      Math.floor(elapsed / flight.segmentMs),
    );
    const segT = (elapsed - segIndex * flight.segmentMs) / flight.segmentMs;
    const eased = easeInOutCubic(Math.min(1, Math.max(0, segT)));

    const a = flight.waypoints[segIndex];
    const b = flight.waypoints[segIndex + 1];
    camera.position.lerpVectors(a, b, eased);

    // Look at the waypoint two ahead when possible, so the camera is
    // already facing the next hatch before it enters it. Fall back to
    // the final waypoint near the end.
    const lookIndex = Math.min(segIndex + 2, flight.waypoints.length - 1);
    camera.lookAt(flight.waypoints[lookIndex]);
  });

  return null;
}

function Scene() {
  const params = useSearchParams();
  const raw = params.get("area");
  const area = isCanonicalArea(raw) ? raw : null;

  return (
    <>
      <ambientLight intensity={0.2} />
      <pointLight position={[55, 2.5, -33]} intensity={8} distance={8} color="#d4e4ff" decay={2} />
      <pointLight position={[55, 2.5, -38]} intensity={8} distance={8} color="#d4e4ff" decay={2} />
      <pointLight position={[55, 2.5, -28]} intensity={8} distance={8} color="#d4e4ff" decay={2} />
      <pointLight position={[50, 2.5, -33]} intensity={6} distance={8} color="#d4e4ff" decay={2} />
      <pointLight position={[60, 2.5, -33]} intensity={6} distance={8} color="#d4e4ff" decay={2} />
      <pointLight position={[55, -0.5, -35]} intensity={3} distance={5} color="#ff9944" decay={2} />
      <pointLight position={[54, 0, -31]} intensity={2} distance={4} color="#44aaff" decay={2} />
      <pointLight position={[56, 0.5, -36]} intensity={1.5} distance={6} color="#ff2200" decay={2} />
      <Suspense fallback={null}>
        <Model />
        <Environment preset="night" environmentIntensity={0.2} />
        <FlightController area={area} />
      </Suspense>
      {/* OrbitControls kept for manual exploration when no flight is active.
          Its target is irrelevant once FlightController calls camera.lookAt each
          frame — the controls lose the thread during a flight, but recover on
          the next user drag. Zoom + pan stay disabled. */}
      <OrbitControls enableZoom={false} enablePan={false} target={CAMERA_TARGET} />
    </>
  );
}

export default function ISSInteriorScene() {
  return (
    <Canvas
      camera={{ position: CAMERA_POSITION, fov: 60, near: 0.01, far: 1000 }}
      gl={{ toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.8 }}
    >
      <Scene />
    </Canvas>
  );
}
```

- [ ] **Step 2: Type-check**

Run:
```
cd client && npx tsc --noEmit
```

Expected: no new errors. If `useSearchParams` complains about Suspense, wrap `<Scene />` in `<Suspense>` at the Canvas level — but in practice Next.js 16 emits a warning, not an error.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/ISSInteriorScene.tsx
git commit -m "Rewrite ISSInteriorScene with waypoint flight"
```

---

### Task 6: Create `InteriorCaption` component

**Files:**
- Create: `client/src/components/InteriorCaption.tsx`

- [ ] **Step 1: Create the file**

Write `client/src/components/InteriorCaption.tsx`:

```typescript
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { DraggableCaption } from "@/components/hud/DraggableCaption";
import { INTERIOR_AREAS, isCanonicalArea } from "@/lib/interiorAreas";

/**
 * Two DOM overlays for the current interior destination:
 *
 * - Top-center banner: "NOW AT <displayName>" — mirrors PartCaption's
 *   language but swaps the verb ("Highlighting" → "Now at").
 * - Bottom-right card: reuses DraggableCaption. Close-X clears the
 *   ?area= param, which triggers the scene's single-segment retreat
 *   to the startup pose.
 *
 * Mounts outside the Canvas so it never fights <Html> portals. Both
 * overlays are gated on a valid canonical area; an unknown area param
 * renders nothing.
 */
export default function InteriorCaption() {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get("area");
  const area = isCanonicalArea(raw) ? raw : null;

  // Reset the draggable offset every time the destination changes, so a
  // fresh flight always lands the card in its default anchor position.
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  useEffect(() => {
    setOffset({ x: 0, y: 0 });
  }, [area]);

  if (!area) return null;
  const entry = INTERIOR_AREAS[area];

  return (
    <>
      <div className="pointer-events-none fixed top-hud-inset left-1/2 -translate-x-1/2 z-30 select-none">
        <div className="flex flex-col items-center leading-tight">
          <span className="font-mono uppercase tracking-[0.3em] text-[9px] text-white-dim">
            Now at
          </span>
          <span className="font-serif text-[28px] text-white mt-1 leading-none">
            {entry.displayName}
          </span>
        </div>
      </div>
      <div className="fixed bottom-hud-inset right-hud-inset z-30 w-[220px] h-0">
        <DraggableCaption
          offset={offset}
          onOffsetChange={setOffset}
          kind={entry.kind}
          name={entry.displayName}
          description={entry.description}
          onClose={() => router.push("/")}
        />
      </div>
    </>
  );
}
```

- [ ] **Step 2: Type-check**

Run:
```
cd client && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/InteriorCaption.tsx
git commit -m "Add InteriorCaption overlay"
```

---

### Task 7: Mount `InteriorCaption` in `page.tsx`

**Files:**
- Modify: `client/src/app/page.tsx`

- [ ] **Step 1: Add the caption to the interior page**

Replace `client/src/app/page.tsx` with:

```typescript
"use client";

import dynamic from "next/dynamic";

const ISSInteriorScene = dynamic(() => import("@/components/ISSInteriorScene"), { ssr: false });
const InteriorCaption = dynamic(() => import("@/components/InteriorCaption"), { ssr: false });

export default function Home() {
  return (
    <div className="h-screen w-screen relative">
      <ISSInteriorScene />
      <InteriorCaption />
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run:
```
cd client && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/app/page.tsx
git commit -m "Mount InteriorCaption on interior page"
```

---

### Task 8: Manual acceptance test

**Files:** none modified — smoke test only.

- [ ] **Step 1: Start the dev server**

```bash
cd client && npm run dev
```

Expected: server listens on `http://localhost:3000`.

- [ ] **Step 2: Golden path — voice nav chain**

Assume the server is also running (see `server/README.md`). In the browser:

1. Load `http://localhost:3000` → default interior pose, no caption.
2. Say: *"Take me to the Cupola."*
   - Expected: HAL acknowledges ("Navigating to the cupola."), banner reads **NOW AT / Cupola**, card appears bottom-right, camera flies through the Node3→Cupola hatch.
3. Say: *"Now Kibo."*
   - Expected: banner updates to **Kibo JPM**, flight replans from Cupola → Tranquility → Unity → Destiny → Harmony → Kibo (a 6-segment traversal of ~3 s).
4. Drag the card → it follows the pointer.
5. Click `×` on the card → camera lerps back to startup pose over ~500 ms; banner + card disappear.

- [ ] **Step 3: Edge cases**

1. Manually visit `http://localhost:3000/?area=columbus` → flies to Columbus, caption appears. Proves URL-as-state.
2. Manually visit `http://localhost:3000/?area=asdf` → no caption, camera stays at startup pose (silent ignore).
3. Repeat `/?area=cupola` twice (change nonce each time) → both navs trigger the flight; no stall.
4. Open the Network tab and confirm no 404s on any glb fetch.
5. Open the console and confirm no warnings beyond the `[interior] hatch node not found: …` that occur only if hatch hints are genuinely wrong (tune in interiorAreas.ts if any fire).

- [ ] **Step 4: Regression sanity**

1. Navigate to `/exterior` — exterior hologram still loads, HUD still populates. Interior flight state should not leak.
2. Voice: *"Highlight the solar arrays."* → works as before (exterior highlight path untouched).
3. Voice: *"Go inside."* → `set_view` routes to `/`. The previous origin (`originRef`) resets on unmount because the component is dynamic-imported; new navs cold-start from `CAMERA_POSITION`.

- [ ] **Step 5: Commit nothing; the acceptance step is a smoke test only.**

If any hatch hint proves wrong (flight cuts through a bulkhead visually), fix the offending entry in `HATCH_HINT` and push as a follow-up. If any typing issue surfaced during `tsc --noEmit` in earlier tasks, they should have been resolved at that step — nothing new to commit here.

---

## Verification Checklist

After all 8 tasks:

- [ ] All pytest tests pass (`cd server && .venv/bin/python -m pytest tests/test_tools.py`)
- [ ] `tsc --noEmit` passes in `client/`
- [ ] `navigate_to` appears in `SYSTEM_PROMPT` with all 10 canonical names
- [ ] Voice path: *"Take me to X"* → HAL flies + captions for every X in the enum
- [ ] URL path: `/?area=<canonical>` works for every canonical name
- [ ] `×` close resets to startup pose
- [ ] Drag card works; position resets on next nav
- [ ] No console warnings about missing glb nodes
- [ ] Exterior page still works (no regressions to `highlight_part`)

---

## Notes on Conventions

- **Commit style.** One commit per task. Subject describes the what, matching the repo's existing convention (`git log` shows e.g. `Rewrite ExteriorHud around real ISS telemetry via Lightstreamer`, `Distribute HUD across four viewport quadrants, drop wheretheiss.at`). No issue references, no co-author footer, no emoji.
- **No mesh highlighting.** Explicitly out of scope — interior is camera-only per the spec. Do not add material swaps for the target module.
- **Hatch-hint tuning.** The `HATCH_HINT` values are best-guess mappings from the glb dump. If manual acceptance shows the camera cutting through a wall on a specific edge, the fix is a one-line swap in `interiorAreas.ts` — no scene rewrite needed.
- **Origin resolution edge cases.** On cold loads with a deep link like `/?area=cupola`, `originRef` is null and the containing-bbox check may or may not hit (depends on whether `CAMERA_POSITION` falls inside any module's bbox). We fall back to a single-segment straight lerp in that case, which is acceptable for v1.
- **Look-ahead targeting.** `camera.lookAt(waypoints[segIndex + 2])` produces a smoother feel than `lookAt(waypoints[segIndex + 1])` because the camera is already turning toward the *next* destination before it enters the current hatch. Fall back to the final waypoint when `segIndex + 2` runs off the end.
