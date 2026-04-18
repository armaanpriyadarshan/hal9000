# Exterior Part Highlight + Camera Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `highlight_part` tool that makes HAL point at sections of the station on the exterior view — matching meshes glow brighter, camera orbits to frame them, a floating HUD label names the part.

**Architecture:** Server registers a second tool (`highlight_part`) with a 7-entry enum of canonical ISS sections. Client owns a registry (`shipParts.ts`) mapping those canonical names to mesh-matching rules (mesh-name prefix or parent-node name) and camera target offsets. The client tool handler navigates to `/exterior?highlight=<canonical>`; `ISSExteriorScene` reads the URL search param, swaps meshes to a brighter shader material, lerps the camera, and renders an `@react-three/drei` `<Html>` label.

**Tech Stack:** Python + FastAPI + Cactus (server, existing). Next.js 16 App Router + React 19 + `@react-three/fiber` + `@react-three/drei` + `three` (client, existing). No new dependencies.

**Spec reference:** `docs/superpowers/specs/2026-04-18-exterior-highlight-parts-design.md`

---

## File Structure

**Create:**
- `client/src/lib/shipParts.ts` — registry of 7 exterior parts: canonical name → `displayName`, `match` rule, `cameraOffset`, `cameraDistanceScale`. Also exports `CANONICAL_PARTS` and `isCanonicalPart` type guard.

**Modify:**
- `server/tools.py` — append `highlight_part` `ToolSpec` to `TOOL_SPECS`.
- `server/tests/test_tools.py` — add 2 tests (registration + description-alias sanity).
- `server/config.py` — extend `SYSTEM_PROMPT` with a paragraph about `highlight_part`.
- `client/src/lib/halTools.ts` — add `highlight_part` handler that `router.push`es to `/exterior?highlight=<canonical>`.
- `client/src/components/ISSExteriorScene.tsx` — structural changes: read URL search param, create a second `ShaderMaterial` (`highlightedMat`), resolve matching meshes via the registry, swap per-mesh materials on highlight change, animate camera via `useFrame`, render `<Html>` label.

---

### Task 1: Register `highlight_part` in `TOOL_SPECS` + tests

**Files:**
- Modify: `server/tools.py`
- Modify: `server/tests/test_tools.py`

- [ ] **Step 1: Write failing test for the new spec**

Append to `server/tests/test_tools.py`:

```python
EXPECTED_HIGHLIGHT_PART_ENUM = [
    "solar_arrays",
    "service_module",
    "p6_truss",
    "s0_truss",
    "external_stowage",
    "ams_experiment",
    "main_modules",
]


def test_highlight_part_is_registered():
    spec = next((s for s in TOOL_SPECS if s.name == "highlight_part"), None)
    assert spec is not None, "highlight_part missing from TOOL_SPECS"
    assert spec.location == "client"
    assert spec.parameters["required"] == ["part"]
    enum = spec.parameters["properties"]["part"]["enum"]
    assert list(enum) == EXPECTED_HIGHLIGHT_PART_ENUM


def test_highlight_part_description_covers_every_canonical_name():
    spec = next((s for s in TOOL_SPECS if s.name == "highlight_part"), None)
    assert spec is not None
    for name in EXPECTED_HIGHLIGHT_PART_ENUM:
        assert name in spec.description, f"canonical name {name!r} missing from description"
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```
cd server && .venv/bin/python -m pytest tests/test_tools.py::test_highlight_part_is_registered -v
```

Expected: `assert spec is not None` → fails because `highlight_part` hasn't been registered.

- [ ] **Step 3: Register `highlight_part` in `server/tools.py`**

Locate `TOOL_SPECS` in `server/tools.py`. It currently has one entry (`set_view`). Append a second entry inside the list:

```python
    ToolSpec(
        name="highlight_part",
        description=(
            "Highlight a labeled section of the station on the exterior "
            "view. Auto-switches to the exterior if the crew is currently "
            "inside, so you do NOT need to call set_view first. The crew "
            "may refer to parts using natural language — map their wording "
            "to one of the canonical names below:\n"
            "- solar_arrays — solar arrays, solar panels, wings, arrays\n"
            "- service_module — Zvezda, service module, Russian segment\n"
            "- p6_truss — P6 truss, port truss, far port, port-end truss\n"
            "- s0_truss — S0 truss, center truss, backbone, central truss\n"
            "- external_stowage — ESP, external stowage, stowage platforms\n"
            "- ams_experiment — AMS, AMS-2, magnetic spectrometer, physics experiment\n"
            "- main_modules — main modules, pressurised modules, habitation"
        ),
        parameters={
            "type": "object",
            "properties": {
                "part": {
                    "type": "string",
                    "enum": [
                        "solar_arrays",
                        "service_module",
                        "p6_truss",
                        "s0_truss",
                        "external_stowage",
                        "ams_experiment",
                        "main_modules",
                    ],
                    "description": "Canonical name of the part to highlight.",
                },
            },
            "required": ["part"],
        },
        location="client",
        ack_template="Highlighting the {part}.",
    ),
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```
cd server && .venv/bin/python -m pytest tests/test_tools.py -v
```

Expected: 15 passed (13 prior + 2 new).

- [ ] **Step 5: Commit**

```
git add server/tools.py server/tests/test_tools.py
git commit -m "Register highlight_part tool with 7-entry enum"
```

---

### Task 2: Create client-side ship parts registry

**Files:**
- Create: `client/src/lib/shipParts.ts`

- [ ] **Step 1: Create the registry file**

Create `/Users/ethan/Documents/Projects/hal9000/client/src/lib/shipParts.ts` with:

```typescript
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```
cd client && npx tsc --noEmit 2>&1 | grep -E "shipParts|^Found" | head -10
```

Expected: no errors in `shipParts.ts`. (Pre-existing errors in `ISSExteriorScene.tsx` / `ISSInteriorScene.tsx` from `three` types are unrelated; ignore.)

- [ ] **Step 3: Commit**

```
git add client/src/lib/shipParts.ts
git commit -m "Add client-side ship parts registry for exterior highlights"
```

---

### Task 3: Wire `highlight_part` into client tool registry

**Files:**
- Modify: `client/src/lib/halTools.ts`

- [ ] **Step 1: Update `CLIENT_TOOLS` in `client/src/lib/halTools.ts`**

Locate the `CLIENT_TOOLS` constant (currently only has `set_view`). Replace the whole `const CLIENT_TOOLS: Record<string, Handler> = { ... }` block with:

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
    router.push(`/exterior?highlight=${encodeURIComponent(part)}`);
  },
};
```

No changes to type declarations, existing `executeClientDirectives`, or imports — the `Handler` type and `ClientToolCtx` already accommodate the new handler.

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```
cd client && npx tsc --noEmit 2>&1 | grep -E "halTools|^Found" | head -10
```

Expected: no errors in `halTools.ts`.

- [ ] **Step 3: Commit**

```
git add client/src/lib/halTools.ts
git commit -m "Handle highlight_part directive by pushing to /exterior?highlight="
```

---

### Task 4: Material-swap highlight in `ISSExteriorScene`

**Files:**
- Modify: `client/src/components/ISSExteriorScene.tsx`

Structural rewrite: extract the shader material into a factory that takes a `highlighted` flag, create both default and highlighted materials, read the highlight param from the URL, resolve matching meshes via the registry, and swap per-mesh materials whenever `highlight` changes. Camera lerp and label come in Tasks 5 and 6.

- [ ] **Step 1: Replace the entire contents of `client/src/components/ISSExteriorScene.tsx`**

Replace the whole file with:

```typescript
"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Stars, useGLTF } from "@react-three/drei";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo } from "react";
import * as THREE from "three";

import {
  SHIP_PARTS,
  isCanonicalPart,
  type CanonicalPart,
  type Match,
} from "@/lib/shipParts";

type OrbitControlsLike = {
  target: THREE.Vector3;
  maxDistance: number;
  minDistance: number;
  update: () => void;
};

const HOLOGRAM_VERSION = "fresnel-v2-hl";
const HIGH_VERTEX_COUNT = 2000;
const EDGE_ANGLE_DEG = 20;

const VERTEX_SHADER = `
  varying vec3 vNormal;
  varying vec3 vViewPos;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPos = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAGMENT_SHADER = `
  uniform vec3 baseColor;
  uniform vec3 rimColor;
  uniform float rimPower;
  uniform float baseAlpha;
  uniform float rimAlpha;
  varying vec3 vNormal;
  varying vec3 vViewPos;
  void main() {
    vec3 V = normalize(vViewPos);
    vec3 N = normalize(vNormal);
    float fresnel = pow(1.0 - max(dot(N, V), 0.0), rimPower);
    vec3 color = mix(baseColor, rimColor, fresnel);
    float alpha = mix(baseAlpha, rimAlpha, fresnel);
    gl_FragColor = vec4(color, alpha);
  }
`;

function makeMaterial(highlighted: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      baseColor: { value: new THREE.Color(0x72b8e0) },
      rimColor: { value: new THREE.Color(highlighted ? 0xffffff : 0xdcf0f8) },
      rimPower: { value: highlighted ? 1.8 : 2.5 },
      baseAlpha: { value: highlighted ? 0.55 : 0.2 },
      rimAlpha: { value: highlighted ? 1.0 : 0.9 },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    side: THREE.FrontSide,
    transparent: true,
    depthWrite: false,
  });
}

function resolveMatchingMeshes(
  scene: THREE.Object3D,
  match: Match,
): Set<THREE.Mesh> {
  const matches = new Set<THREE.Mesh>();
  if (match.kind === "parent") {
    for (const parentName of match.values) {
      const parent = scene.getObjectByName(parentName);
      if (!parent) continue;
      parent.traverse((child) => {
        if (child instanceof THREE.Mesh) matches.add(child);
      });
    }
  } else {
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const name = child.name;
      if (match.values.some((v) => name.startsWith(v))) matches.add(child);
    });
  }
  return matches;
}

function HologramModel({ highlight }: { highlight: CanonicalPart | null }) {
  const { scene } = useGLTF("/iss-exterior.glb");
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitControlsLike | null;

  const defaultMat = useMemo(() => makeMaterial(false), []);
  const highlightedMat = useMemo(() => makeMaterial(true), []);
  const lineMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: 0xccf5ff,
        transparent: true,
        opacity: 0.85,
      }),
    [],
  );

  // Initial load: tag meshes with default material + edges; frame the camera on the full ISS.
  useEffect(() => {
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const stale: THREE.Object3D[] = [];
      for (const c of child.children) {
        if (c instanceof THREE.LineSegments) {
          c.geometry.dispose();
          stale.push(c);
        }
      }
      stale.forEach((c) => child.remove(c));
      child.visible = true;
      if (child.userData.hologramVersion === HOLOGRAM_VERSION) return;

      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((m) => m.dispose());
      child.material = defaultMat;
      const count = child.geometry.attributes.position?.count ?? 0;
      if (count <= HIGH_VERTEX_COUNT) {
        const edges = new THREE.EdgesGeometry(child.geometry, EDGE_ANGLE_DEG);
        child.add(new THREE.LineSegments(edges, lineMat));
      }
      child.userData.hologramVersion = HOLOGRAM_VERSION;
    });

    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const diag = size.length();

    const startDistance = diag * 1.1;
    const maxDistance = diag * 1.8;
    const minDistance = diag * 0.05;

    camera.position.set(center.x, center.y, center.z + startDistance);
    camera.lookAt(center);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.near = Math.max(diag * 0.001, 0.01);
      camera.far = diag * 10;
      camera.updateProjectionMatrix();
    }
    if (controls) {
      controls.target.copy(center);
      controls.maxDistance = maxDistance;
      controls.minDistance = minDistance;
      controls.update();
    }
  }, [scene, camera, controls, defaultMat, lineMat]);

  // Highlight pass: swap per-mesh materials based on the current highlight.
  useEffect(() => {
    const matching = highlight
      ? resolveMatchingMeshes(scene, SHIP_PARTS[highlight].match)
      : new Set<THREE.Mesh>();
    if (highlight && matching.size === 0) {
      console.warn(`[shipParts] no meshes matched for "${highlight}"`);
    }
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.material = matching.has(child) ? highlightedMat : defaultMat;
    });
  }, [scene, highlight, defaultMat, highlightedMat]);

  return <primitive object={scene} />;
}

export default function ISSExteriorScene() {
  const searchParams = useSearchParams();
  const highlightRaw = searchParams.get("highlight");
  const highlight: CanonicalPart | null = isCanonicalPart(highlightRaw)
    ? highlightRaw
    : null;

  return (
    <Canvas camera={{ position: [0, 0, 30], fov: 50, near: 0.1, far: 1000 }}>
      <color attach="background" args={["#000000"]} />
      <Stars
        radius={400}
        depth={120}
        count={6000}
        factor={5}
        saturation={0}
        fade
        speed={0.3}
      />
      <Suspense fallback={null}>
        <HologramModel highlight={highlight} />
      </Suspense>
      <OrbitControls enableZoom enableDamping makeDefault />
    </Canvas>
  );
}
```

Notice I bumped `HOLOGRAM_VERSION` to `"fresnel-v2-hl"` so the userData gate re-runs once on first boot after this change (otherwise meshes keep the prior-version default material).

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```
cd client && npx tsc --noEmit 2>&1 | grep -E "ISSExteriorScene|^Found" | head -20
```

Expected: either no errors, or only pre-existing errors related to `three` types (same as before this task). The new `HologramModel` signature and `isCanonicalPart` usage should type-check.

- [ ] **Step 3: Visual verification via URL (no voice needed)**

With both servers running (restart as needed), open `http://localhost:3000/exterior?highlight=service_module` in the browser. Expected: the meshes under `sm_ext_sm*` names (the Russian Service Module area) should look noticeably brighter than the rest. Try `?highlight=solar_arrays`, `?highlight=p6_truss` — each should emphasise a different section. No camera movement yet — that's Task 5.

If the highlighted meshes look identical to non-highlighted (no visible emphasis), inspect console for `[shipParts] no meshes matched` warnings. If warnings fire, the registry's `match.values` are wrong for that part — revisit during impl.

- [ ] **Step 4: Commit**

```
git add client/src/components/ISSExteriorScene.tsx
git commit -m "Swap materials per-mesh based on URL highlight param"
```

---

### Task 5: Camera lerp when highlight changes

**Files:**
- Modify: `client/src/components/ISSExteriorScene.tsx`

- [ ] **Step 1: Update imports**

In `client/src/components/ISSExteriorScene.tsx`, change the imports from `@react-three/fiber` and `react` to include `useFrame` and `useRef`:

Locate:
```typescript
import { Canvas, useThree } from "@react-three/fiber";
...
import { Suspense, useEffect, useMemo } from "react";
```

Replace with:
```typescript
import { Canvas, useFrame, useThree } from "@react-three/fiber";
...
import { Suspense, useEffect, useMemo, useRef } from "react";
```

- [ ] **Step 2: Add lerp types and easing helper**

Below the existing constants (after `EDGE_ANGLE_DEG` and before `VERTEX_SHADER`), add:

```typescript
const LERP_DURATION_MS = 1200;

type Lerp = {
  startPos: THREE.Vector3;
  startTarget: THREE.Vector3;
  endPos: THREE.Vector3;
  endTarget: THREE.Vector3;
  t0: number;
};

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
```

- [ ] **Step 3: Rewrite the highlight `useEffect` to also seed the lerp, and add the `useFrame` animator**

In `HologramModel`, find the existing "Highlight pass" `useEffect` (the second one, added in Task 4):

```typescript
  useEffect(() => {
    const matching = highlight
      ? resolveMatchingMeshes(scene, SHIP_PARTS[highlight].match)
      : new Set<THREE.Mesh>();
    if (highlight && matching.size === 0) {
      console.warn(`[shipParts] no meshes matched for "${highlight}"`);
    }
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.material = matching.has(child) ? highlightedMat : defaultMat;
    });
  }, [scene, highlight, defaultMat, highlightedMat]);
```

Replace with:

```typescript
  const lerpRef = useRef<Lerp | null>(null);

  useEffect(() => {
    const matching = highlight
      ? resolveMatchingMeshes(scene, SHIP_PARTS[highlight].match)
      : new Set<THREE.Mesh>();
    if (highlight && matching.size === 0) {
      console.warn(`[shipParts] no meshes matched for "${highlight}"`);
    }
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.material = matching.has(child) ? highlightedMat : defaultMat;
    });

    if (!highlight || matching.size === 0) {
      lerpRef.current = null;
      return;
    }
    const entry = SHIP_PARTS[highlight];
    const box = new THREE.Box3();
    matching.forEach((m) => box.expandByObject(m));
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const diag = Math.max(size.length(), 0.1);
    const scale = entry.cameraDistanceScale ?? 1.8;
    const dir = new THREE.Vector3(...entry.cameraOffset).normalize();
    const endPos = center.clone().add(dir.multiplyScalar(diag * scale));

    lerpRef.current = {
      startPos: camera.position.clone(),
      startTarget: controls?.target.clone() ?? center.clone(),
      endPos,
      endTarget: center,
      t0: performance.now(),
    };
  }, [scene, highlight, camera, controls, defaultMat, highlightedMat]);

  useFrame(() => {
    const lerp = lerpRef.current;
    if (!lerp) return;
    const t = Math.min((performance.now() - lerp.t0) / LERP_DURATION_MS, 1);
    const e = easeInOutCubic(t);
    camera.position.lerpVectors(lerp.startPos, lerp.endPos, e);
    if (controls) {
      controls.target.lerpVectors(lerp.startTarget, lerp.endTarget, e);
      controls.update();
    }
    if (t >= 1) lerpRef.current = null;
  });
```

- [ ] **Step 4: Verify TypeScript compiles**

Run:
```
cd client && npx tsc --noEmit 2>&1 | grep -E "ISSExteriorScene|^Found" | head -20
```

Expected: no new errors beyond pre-existing three-type noise.

- [ ] **Step 5: Visual verification**

With servers running, open `http://localhost:3000/exterior?highlight=service_module`. Expected: the camera should smoothly lerp (~1.2s) from the full-ISS framing to a closer shot of the Service Module area. Change the URL param to another part (e.g. `?highlight=solar_arrays`) — camera smoothly animates to the new target.

If the camera snaps instead of lerping, check that `useFrame` is inside the `<Canvas>` tree (it is — `HologramModel` is wrapped in `<Suspense>` inside `<Canvas>`). If it lerps to a bad angle, we'll tune `cameraOffset` per entry in `shipParts.ts` during manual acceptance.

- [ ] **Step 6: Commit**

```
git add client/src/components/ISSExteriorScene.tsx
git commit -m "Lerp camera to frame the highlighted part"
```

---

### Task 6: Floating HUD label via `<Html>`

**Files:**
- Modify: `client/src/components/ISSExteriorScene.tsx`

- [ ] **Step 1: Update the drei import**

In `client/src/components/ISSExteriorScene.tsx`, change:

```typescript
import { OrbitControls, Stars, useGLTF } from "@react-three/drei";
```

to:

```typescript
import { Html, OrbitControls, Stars, useGLTF } from "@react-three/drei";
```

- [ ] **Step 2: Add `useState` import and `boxCenter` state**

Update the react import:

```typescript
import { Suspense, useEffect, useMemo, useRef } from "react";
```

to:

```typescript
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
```

In `HologramModel`, right below the line `const lerpRef = useRef<Lerp | null>(null);`, add:

```typescript
  const [boxCenter, setBoxCenter] = useState<THREE.Vector3 | null>(null);
```

- [ ] **Step 3: Wire `boxCenter` into the highlight effect**

In the same highlight `useEffect` (that sets the lerp), find the two exit points and the lerp assignment, and add `setBoxCenter` calls.

Current body:
```typescript
    if (!highlight || matching.size === 0) {
      lerpRef.current = null;
      return;
    }
    const entry = SHIP_PARTS[highlight];
    const box = new THREE.Box3();
    matching.forEach((m) => box.expandByObject(m));
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const diag = Math.max(size.length(), 0.1);
    const scale = entry.cameraDistanceScale ?? 1.8;
    const dir = new THREE.Vector3(...entry.cameraOffset).normalize();
    const endPos = center.clone().add(dir.multiplyScalar(diag * scale));

    lerpRef.current = {
      startPos: camera.position.clone(),
      startTarget: controls?.target.clone() ?? center.clone(),
      endPos,
      endTarget: center,
      t0: performance.now(),
    };
  }, [scene, highlight, camera, controls, defaultMat, highlightedMat]);
```

Replace with:
```typescript
    if (!highlight || matching.size === 0) {
      lerpRef.current = null;
      setBoxCenter(null);
      return;
    }
    const entry = SHIP_PARTS[highlight];
    const box = new THREE.Box3();
    matching.forEach((m) => box.expandByObject(m));
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const diag = Math.max(size.length(), 0.1);
    const scale = entry.cameraDistanceScale ?? 1.8;
    const dir = new THREE.Vector3(...entry.cameraOffset).normalize();
    const endPos = center.clone().add(dir.multiplyScalar(diag * scale));

    lerpRef.current = {
      startPos: camera.position.clone(),
      startTarget: controls?.target.clone() ?? center.clone(),
      endPos,
      endTarget: center,
      t0: performance.now(),
    };
    setBoxCenter(center);
  }, [scene, highlight, camera, controls, defaultMat, highlightedMat]);
```

- [ ] **Step 4: Render the label in `HologramModel`'s JSX**

Change the `HologramModel` return value from:

```typescript
  return <primitive object={scene} />;
```

to:

```typescript
  return (
    <>
      <primitive object={scene} />
      {highlight && boxCenter && (
        <Html
          position={[boxCenter.x, boxCenter.y, boxCenter.z]}
          center
          distanceFactor={8}
        >
          <div className="pointer-events-none text-cyan-200 text-xs uppercase tracking-wide bg-black/60 px-2 py-1 rounded border border-cyan-400/40 whitespace-nowrap">
            {SHIP_PARTS[highlight].displayName}
          </div>
        </Html>
      )}
    </>
  );
```

- [ ] **Step 5: Verify TypeScript compiles**

Run:
```
cd client && npx tsc --noEmit 2>&1 | grep -E "ISSExteriorScene|^Found" | head -20
```

Expected: no new errors.

- [ ] **Step 6: Visual verification**

Open `http://localhost:3000/exterior?highlight=service_module`. Expected:
- Meshes glow brighter (Task 4).
- Camera lerps to frame (Task 5).
- A small HUD label "Zvezda Service Module" floats near the target, scaling with camera distance (Task 6).

Switch `?highlight=solar_arrays` and confirm the label text updates to "Solar Arrays".

If the label overlaps the 3D scene awkwardly or is too large/small, tune `distanceFactor` (currently `8`).

- [ ] **Step 7: Commit**

```
git add client/src/components/ISSExteriorScene.tsx
git commit -m "Render floating HUD label for highlighted part"
```

---

### Task 7: Extend `SYSTEM_PROMPT` with highlight_part nudge

**Files:**
- Modify: `server/config.py`

- [ ] **Step 1: Update `SYSTEM_PROMPT`**

In `server/config.py`, locate the existing set_view nudge block:

```python
    "You can also switch the primary display between the station's "
    "interior and exterior views when the crew asks to see inside, "
    "outside, or looks at a particular part of the ship. Use the "
    "set_view tool rather than describing the change in prose.\n"
    "\n"
    "You are not Mission Control. You are the crew's colleague — "
    "reliable, attentive, and never panicked."
```

Replace with:

```python
    "You can also switch the primary display between the station's "
    "interior and exterior views when the crew asks to see inside, "
    "outside, or looks at a particular part of the ship. Use the "
    "set_view tool rather than describing the change in prose.\n"
    "\n"
    "When the crew asks to see a specific external section of the "
    "station — the solar arrays, Zvezda service module, a truss "
    "segment, stowage platforms, the AMS experiment, or the main "
    "pressurised modules — use the highlight_part tool. It "
    "auto-switches to the exterior view if needed; you do not need "
    "to call set_view first.\n"
    "\n"
    "You are not Mission Control. You are the crew's colleague — "
    "reliable, attentive, and never panicked."
```

- [ ] **Step 2: Verify the prompt still loads and the new paragraph is present**

Run:
```
cd server && .venv/bin/python -c "from config import SYSTEM_PROMPT; print('highlight_part' in SYSTEM_PROMPT, SYSTEM_PROMPT[-400:])"
```

Expected: prints `True` (indicates the new paragraph was added) followed by the last ~400 chars of the prompt, which should end in `"reliable, attentive, and never panicked."` with the highlight_part paragraph immediately above.

- [ ] **Step 3: Commit**

```
git add server/config.py
git commit -m "Teach HAL's system prompt about highlight_part"
```

---

### Task 8: Manual acceptance test

**Files:** none — verification only.

**Precondition:**
- Server restarted after Task 1 + Task 7 changes: `server/.venv/bin/python -m uvicorn server:app --host 0.0.0.0 --port 8000`
- Client dev server restarted (or hot-reloaded) with changes from Tasks 2-6.
- Both report "All models ready" / "Ready" respectively.

- [ ] **Step 1: URL acceptance path (no voice)**

Open each of these in order and confirm the described result:

1. `http://localhost:3000/exterior?highlight=solar_arrays` → PAINEIS meshes glow; camera frames them; label "Solar Arrays".
2. `http://localhost:3000/exterior?highlight=service_module` → sm_ext_sm meshes glow; camera lerps; label "Zvezda Service Module".
3. `http://localhost:3000/exterior?highlight=p6_truss` → P6 meshes; label "P6 Truss".
4. `http://localhost:3000/exterior?highlight=s0_truss` → S0 meshes; label "S0 Truss".
5. `http://localhost:3000/exterior?highlight=external_stowage` → ESP2 + ESP3 meshes; label "External Stowage Platforms".
6. `http://localhost:3000/exterior?highlight=ams_experiment` → AMS2 meshes; label "AMS-2 Experiment".
7. `http://localhost:3000/exterior?highlight=main_modules` → MODULO1 + MODULO2 descendants; label "Main Modules".
8. `http://localhost:3000/exterior?highlight=cupola` (not in registry) → no highlight, no label, default scene.
9. `http://localhost:3000/exterior` (no param) → default full-ISS view, no label.

If any step shows zero highlight (meshes unchanged or console warns `no meshes matched`), the registry entry's `match.values` are wrong for that part — iterate.

- [ ] **Step 2: Voice acceptance path (end-to-end with Gemma)**

From `/`, issue each command and observe:

1. *"HAL, show me the solar arrays."* → auto-navigates to `/exterior?highlight=solar_arrays`, camera lerps, label appears. HAL speaks ack.
2. *"Now show me Zvezda."* → swaps to `service_module` (alias in description). Smooth transition.
3. *"Show me the backbone."* → `s0_truss` via "backbone" alias.
4. *"Show me the cupola."* → not in enum; HAL speaks *"I am unable to comply with that request, Ethan."* Visual state unchanged.
5. *"Let me see inside."* → `set_view(interior)` navigates to `/`; highlight cleared.
6. *"What should I do if there's an ammonia leak?"* → no navigation, no highlight; HAL answers from RAG (regression check).

- [ ] **Step 3: Camera offset tuning (if needed)**

If after visual inspection the camera ends up at a weird angle for any part (inside the mesh, too far away, behind another module), edit the offending entry in `client/src/lib/shipParts.ts`. `cameraOffset` is a direction vector (normalised before use), `cameraDistanceScale` multiplies the bounding-box diagonal. Commit tuning changes:

```
git add client/src/lib/shipParts.ts
git commit -m "Tune camera offsets for <part>"
```

- [ ] **Step 4: Ack-phrasing check**

During step 2, listen for the ack. `"Highlighting the service_module."` may read awkwardly spoken. If so, either:
- Swap to generic: edit `server/tools.py` → change `ack_template` to `"Highlighting that section on the exterior."`
- Or thread displayName through dispatch (bigger change, defer unless really needed).

Commit whatever you change:
```
git add server/tools.py
git commit -m "Use generic ack for highlight_part"
```

- [ ] **Step 5: Report**

No code changes in this task unless tuning was needed. If any acceptance step failed, open a follow-up task with: the step that failed, what you said / what you typed, what you observed, and — for voice path — the server log's `[turn N]` line showing `function_calls`.

---

## Notes for the Implementer

- **glb mesh naming is fragile.** If the glb is ever replaced or re-exported, the prefix/parent values in `shipParts.ts` will drift. The `console.warn` on zero matches is the canary. When you see it, re-run the inspector from the spec's Background section to find new names.
- **`cameraOffset` tuning is not optional.** The starting value `[1, 0.2, 1]` is a guess. Plan to spend 5-10 minutes with the browser open tuning each part's offset after Task 5 lands. This is expected, not a sign anything's broken.
- **`HOLOGRAM_VERSION` bump matters.** If the userData gate sees an old version string on a mesh (from a pre-this-plan render), the mesh keeps its stale material assignment forever. Bumping to `"fresnel-v2-hl"` forces a one-time re-run on first load after the code change.
- **The shader is shared across hundreds of meshes.** Do NOT mutate `material.uniforms` per-mesh — uniforms belong to the material, not the mesh. The material-swap model (two pre-built materials, per-mesh pointer swap) is what keeps this fast.
- **`useSearchParams()` must be called inside a Client Component.** `ISSExteriorScene` already has `"use client"` at the top, and `client/src/app/exterior/page.tsx` imports it via `dynamic(..., { ssr: false })`, so the Next.js RSC boundary is respected.
- **Race with the glb load is handled by effect deps.** The highlight effect depends on both `scene` and `highlight`; it re-runs whenever either lands. No explicit `loading` state is needed.
