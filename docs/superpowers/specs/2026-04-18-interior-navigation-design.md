# Interior Navigation — Design

**Date:** 2026-04-18
**Status:** Approved design; ready for implementation planning
**Scope:** A third tool `navigate_to(area)` that flies the interior camera along a path of hatches through the station to a destination module, and a matching caption (top banner + draggable info card) announcing the arrival. Camera-only navigation — no mesh highlighting.

## Goal

The crew says "take me to the Cupola" and HAL actually takes them there. The interior camera traverses through the connecting hatches along the real ISS topology instead of teleporting or cutting, so the experience feels like a walk-through of the station. Matches the exterior's typography + caption language so the two routes feel like one product.

## Non-goals

- Mesh highlighting inside the modules. The exterior's `highlight_part` pattern does not apply; interior is camera-only.
- Physical collision handling. The camera passes through hatch centres in straight segments; it does not "steer" around bulkheads mid-segment.
- Continuous-curve spline paths. Segment-by-segment lerps are good enough and easier to reason about than Catmull-Rom through six waypoints.
- Per-module focal-point meshes / leader-line anchors. Considered and rejected during brainstorming — camera is inside the module, the room itself is the label.
- Dynamic pathfinding with obstacle avoidance. The adjacency graph is hand-authored from the real ISS topology.

## Background

Inspection of `client/public/iss-interior.glb`:

- 428 nodes, 234 meshes, 33 materials. No glTF extras, no Sketchfab annotation blobs, no embedded cameras. The "annotations" are the semantic node names.
- Top-level module groups under `ISS_Assembled_Interior`:
  - `PMM` (Permanent Multipurpose Module / Leonardo)
  - `Node1` (Unity)
  - `Node2` (Harmony)
  - `Node3` (Tranquility)
  - `Cupola`
  - `US_Lab.CenterOfNodeForRoulette` (Destiny — US Lab)
  - `Columbus` (ESA lab)
  - `JPM` (Kibo main Pressurised Module)
  - `JLP` (Kibo Logistics Pressurised Section)
  - `Airlock_Int_Sys` (Quest Airlock)
  - `Module_Connectors` — tunnel geometry between modules, excluded from the navigation catalog.
- Each module has nested hatch groups like `Node1_Int_Hub.FWD`, `Node1_Int_Hub.NDR`, `Node2_Int_Hub.PRT` — exactly the waypoints needed for flythrough.

Existing interior rendering lives in `client/src/components/ISSInteriorScene.tsx`, which currently pins the camera at hard-coded constants `CAMERA_POSITION` and `CAMERA_TARGET`. The design reuses that file as the integration point rather than rewriting it.

Existing UI primitives we reuse: `DraggableCaption` (from the exterior feature) for the info card, the `text-white-dim`/`font-serif`/`font-mono` design tokens, the `easeInOutCubic` helper.

## Architecture

### Server — `server/tools.py`

Add a third `ToolSpec`, `navigate_to`:

- `parameters`: one required `area` string, enum over 10 canonical names:
  - `pmm`, `unity`, `harmony`, `tranquility`, `cupola`, `destiny`, `columbus`, `kibo_jpm`, `kibo_jlp`, `airlock`.
- `description`: lists each canonical with its natural-language aliases (e.g. `destiny → Destiny, US Lab`; `kibo_jpm → Kibo, JPM, Japanese Pressurized Module`; `airlock → Quest, airlock, EVA prep`). Tells HAL to map crew phrasing to the closest canonical and prefer the tool over prose.
- `location: "client"`, `handler: None`.
- `ack_template: "Navigating to the {area}."`.

### Server — `server/config.py`

Extend `SYSTEM_PROMPT`'s Tools Available block with a third entry for `navigate_to`, mirroring the structure used for `highlight_part`: each canonical name on its own line with comma-separated aliases. Reinforces the prompt-side catalog for non-tool turns (e.g., when the model decides whether to invoke the tool vs describe prose).

### Client — new `client/src/lib/interiorAreas.ts`

```ts
export const CANONICAL_AREAS = [
  "pmm", "unity", "harmony", "tranquility", "cupola",
  "destiny", "columbus", "kibo_jpm", "kibo_jlp", "airlock",
] as const;
export type CanonicalArea = (typeof CANONICAL_AREAS)[number];

export type AreaEntry = {
  displayName: string;     // "Cupola", "Harmony (Node 2)"
  kind: string;            // "Observation Dome", "Utility Node"
  description: string;     // one-sentence real-ISS blurb
  glbNodeName: string;     // "Cupola", "Node2", "US_Lab.CenterOfNodeForRoulette"
};

export const INTERIOR_AREAS: Record<CanonicalArea, AreaEntry> = { … };

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

// Directional hatch-node hints (undirected — lookup falls back to reversed key).
export const HATCH_HINT: Record<string, string> = {
  "unity→destiny":      "Node1_Int_Hub.FWD",
  "unity→tranquility":  "Node1_Int_Hub.PRT",
  "unity→airlock":      "Node1_Int_Hub.SBD",
  "tranquility→cupola": "Node3_Int_Hub.NDR",
  "tranquility→pmm":    "Node3_Int_Hub.AFT",
  "destiny→harmony":    "Node2_Int_Hub.AFT",
  "harmony→columbus":   "Node2_Int_Hub.SBD",
  "harmony→kibo_jpm":   "Node2_Int_Hub.PRT",
  "kibo_jpm→kibo_jlp":  "JPM_Int_Hub.ZNH",  // tune during impl if off
};

export function isCanonicalArea(v: unknown): v is CanonicalArea { … }

// Shortest-path traversal through the adjacency graph.
export function bfs(
  from: CanonicalArea,
  to: CanonicalArea,
): CanonicalArea[] | null { … }
```

Actual hatch-node names come from the glb dump at implementation time; if a hint is wrong the flight still resolves via the "midpoint between module centres" fallback.

### Client — modified `client/src/lib/halTools.ts`

Add `navigate_to` entry to `CLIENT_TOOLS`:

```ts
navigate_to: (args, { router }) => {
  const area = typeof args.area === "string" ? args.area : "";
  if (!area) return;
  router.push(`/?area=${encodeURIComponent(area)}&t=${Date.now().toString(36)}`);
},
```

The `&t=<base36 epoch>` nonce allows repeat navigations to the same area to retrigger the scene's effect (Next.js dedupes identical URLs otherwise).

### Client — modified `client/src/components/ISSInteriorScene.tsx`

- Reads `useSearchParams().get("area")`, validates via `isCanonicalArea`.
- Reads the area → glbNodeName → world-space bounding box centre for each area (memoised on scene load so we don't recompute every nav).
- Maintains a `flightRef`:
  ```ts
  type Flight = {
    waypoints: THREE.Vector3[];
    startedAt: number;
    segmentMs: number;
  };
  ```
- A `useEffect` keyed on `[scene, area]` plans the flight:
  1. Resolve origin: if a previous `originRef.current` is valid, use it; else find the module whose world-bbox contains `camera.position`; else fall back to the startup pose module.
  2. Resolve target from `area`.
  3. `bfs(origin, target)` → module chain.
  4. Build waypoint list: `[origin.bboxCentre, ...hatchCentres, target.bboxCentre]`. For each consecutive pair `(A, B)` look up `HATCH_HINT["A→B"]` (or reversed); resolve via `scene.getObjectByName`; take its world-bbox centre. Fallback = midpoint of module bbox centres.
  5. Set `flightRef.current = { waypoints, startedAt: now, segmentMs: 500 }`.
  6. Update `originRef.current = target`.
- A `useFrame` hook walks the flight each frame: compute segment index, ease within segment, `lerpVectors` position, `lookAt` the waypoint two ahead (final waypoint when at the end), clear the flight ref when finished.
- On `area === null`: single 500 ms lerp back to `CAMERA_POSITION`/`CAMERA_TARGET` constants. No path planning for the clear case — we just unwind to the startup pose.

### Client — new `client/src/components/InteriorCaption.tsx`

Two DOM overlays outside the Canvas:

1. **Top-center banner** — mirrors `PartCaption`. Reads `useSearchParams().get("area")`, validates. Renders:
   ```
       NOW AT
     <displayName>
   ```
   `pointer-events-none`, `z-30`. `displayName` in EB Garamond 28 px.
2. **Draggable info card** — reuses `DraggableCaption` component. Wrapped in a fixed-position div at `bottom-hud-inset right-hud-inset` so the bottom-right of the viewport. `kind` / `displayName` / `description` fed from `INTERIOR_AREAS[area]`. Drag offset state + close-X reset via `router.push('/')`.

### Client — modified `client/src/app/page.tsx`

```tsx
<div className="h-screen w-screen relative">
  <ISSInteriorScene />
  <InteriorCaption />
</div>
```

## Data Flow (one voice turn)

```
[user says]
"HAL, take me to the Cupola"
POST /api/voice ──► Gemma emits highlight_part / navigate_to token
                   (Cactus may need the bareword-JSON repair)
              ◄── function_calls = [{name: "navigate_to",
                                     arguments: {area: "cupola"}}]
dispatch() validates the enum → OK
ack = "Navigating to the cupola."
tts + return with client_directives

Browser ─►
executeClientDirectives:
  navigate_to → router.push("/?area=cupola&t=<nonce>")

/page.tsx re-renders:
  - InteriorCaption reads ?area=cupola → banner + card appear
  - ISSInteriorScene reads ?area=cupola → plans flight:
      origin=destiny (previous area), target=cupola
      bfs → [destiny, unity, tranquility, cupola]
      waypoints → [
        destiny.centre,
        hatch(destiny→unity),
        unity.centre,
        hatch(unity→tranquility),
        tranquility.centre,
        hatch(tranquility→cupola),
        cupola.centre
      ]  (7 waypoints, 6 segments, ~3 s)
    useFrame walks segments, camera.lookAt waypoint-ahead.
```

## Error Handling

| Failure | Detection | Behavior |
|---|---|---|
| Gemma emits invalid enum | existing `jsonschema` in dispatch | generic error ack, no directive |
| BFS returns null (adjacency typo) | `bfs() === null` | `console.warn`, skip flight, still show caption so user at least sees the label |
| Hatch-node missing in glb | `getObjectByName` undefined | Fallback to midpoint of module bbox centres |
| Module `glbNodeName` missing | same | `console.warn`, origin falls back to startup camera position |
| Bogus URL `/?area=asdf` | `isCanonicalArea` false | Treated as no area — caption hidden, camera stays at startup pose |
| Repeat nav to same area | Origin equals target in BFS | Single-waypoint flight → no-op; caption still updates (useful confirmation) |
| New nav during flight | Effect re-runs, rebuilds waypoint list from `camera.position` | Smooth redirect, no stall |

## Testing

**Server side** — one new pytest in `server/tests/test_tools.py`:

- Assert `navigate_to` is registered in `TOOL_SPECS` with exactly the 10-canonical enum and `location: "client"`.
- Assert the description mentions each canonical name at least once.

**Client side** — no automated tests. Consistent with existing framework policy.

**Manual acceptance** (golden path, documented in the plan):

1. Fresh `/` load → default camera pose, no caption.
2. Voice: *"Take me to the Cupola."* → banner + card appear immediately; camera flies through hatches along the adjacency path; ends inside Cupola.
3. Voice: *"Now Kibo."* → banner updates to Kibo JPM; flight replans from current position through Node3 → Node1 → Destiny → Node2 → Kibo.
4. Drag the card → it follows the pointer. Reset position on next `navigate_to`.
5. Click `×` → camera lerps (0.5 s) back to startup pose; caption disappears.
6. Manually visit `/?area=columbus` → camera flies to Columbus; caption appears. URL-as-state works without voice.
7. Ask for a module not in the enum (e.g., "Zvezda") → HAL plays generic "I am unable to comply" line.

## Open Questions

None blocking implementation. Things to revisit during manual acceptance:

- **Hatch-hint accuracy.** Some `HATCH_HINT` entries are guesses based on the PRT/STBD/FWD/AFT/ZNH/NDR convention. Wrong hints fall back to midpoint and fly a straighter line; once seen in the browser, bad hints can be swapped for the right node name.
- **Segment pacing.** 500 ms per segment is a starting value. If a long path (e.g. Airlock→Kibo JLP, 6 segments) feels sluggish, shorten to 350 ms; if it feels whippy, lengthen to 650.
- **Card offset initial position.** Bottom-right was picked to avoid the HAL orb; if the card's default position collides with the bottom-right HUD quadrant of the interior view (once we have one), move it.
- **Origin snap on fresh load.** If the user deep-links to `/?area=cupola` straight from a cold page load, there's no prior camera position to do BFS from — we fall back to the module containing `CAMERA_POSITION`. That'll do for v1; if the cold flight feels wrong, we can add a "straight-lerp-without-BFS" mode for cold starts.
