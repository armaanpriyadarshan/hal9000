# Holographic ISS Exterior View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-screen holographic exterior view of the ISS, reachable from the existing interior view via a toggle button.

**Architecture:** Two sibling scene components (`ISSInteriorScene`, `ISSExteriorScene`) mounted one-at-a-time by `page.tsx` based on a `useState` view flag. The exterior scene loads a second GLB and replaces every material with a cyan `MeshBasicMaterial({ wireframe: true })`, then pipes the render through `@react-three/postprocessing`'s `<Bloom>` pass to produce the glowing-wire hologram effect.

**Tech Stack:** Next.js 16.2.4 (App Router), React 19, three.js 0.184, @react-three/fiber 9, @react-three/drei 10, @react-three/postprocessing (new), TypeScript 5, Tailwind v4.

**Testing note:** This is a visual feature. There are no unit tests. Each task ends with a manual verification step run in the dev server. The engineer must actually look at the page — "the dev server started without errors" is not the same as "the feature works."

**Next.js caveat:** `client/AGENTS.md` warns that this Next.js version has breaking changes from the model's training data and directs to consult `client/node_modules/next/dist/docs/` before writing code. The patterns used in this plan (`"use client"` components, `next/dynamic` with `ssr: false`, standard hooks) are already working in the existing codebase (see `client/src/app/page.tsx`), so no docs lookup is strictly required for execution — but if any step produces an unexpected Next.js error, consult those docs before working around it.

**All paths below are relative to the repo root `/Users/ethan/Documents/Projects/hal9000/` unless otherwise noted.**

---

## Task 1: Asset setup — create `public/` and copy both GLBs

Currently `client/public/` does not exist on disk. The existing interior scene references `/iss_interiorinternational_space_station.glb` but the file is not present locally, so the app is broken until this task completes. This task also renames the interior file for consistency with the new exterior file.

**Files:**
- Create: `client/public/` (directory)
- Copy into: `client/public/iss-interior.glb` (source: `~/Downloads/iss_interiorinternational_space_station.glb`)
- Copy into: `client/public/iss-exterior.glb` (source: `~/Downloads/international_space_station_-_iss.glb`)

- [ ] **Step 1: Create the public directory**

Run:
```bash
mkdir -p client/public
```

- [ ] **Step 2: Copy interior GLB with renamed filename**

Run:
```bash
cp ~/Downloads/iss_interiorinternational_space_station.glb client/public/iss-interior.glb
```

- [ ] **Step 3: Copy exterior GLB with renamed filename**

Run:
```bash
cp ~/Downloads/international_space_station_-_iss.glb client/public/iss-exterior.glb
```

- [ ] **Step 4: Verify both files exist and are non-trivial in size**

Run:
```bash
ls -lh client/public/iss-interior.glb client/public/iss-exterior.glb
```
Expected: both files exist, interior ~37MB, exterior ~24MB.

- [ ] **Step 5: Decide whether to commit the GLB binaries**

These files are ~61MB combined. They are not currently in `.gitignore`. Before committing, ask the user:

> "The two GLB files total ~61MB. Commit them to the repo, or add them to `.gitignore` and keep them local-only? (If local-only, your partner will need to do the same `cp` steps on their machine.)"

If user says **commit:** proceed to Step 6 as written.
If user says **gitignore:** add two lines to `client/.gitignore`:
```
/public/*.glb
```
Then in Step 6, stage only `client/.gitignore` instead of the GLBs.

- [ ] **Step 6: Commit**

If committing GLBs:
```bash
git add client/public/iss-interior.glb client/public/iss-exterior.glb
git commit -m "Add interior and exterior ISS GLB assets"
```

If gitignoring:
```bash
git add client/.gitignore
git commit -m "Gitignore local GLB assets in client/public"
```

---

## Task 2: Add `@react-three/postprocessing` dependency

The exterior scene uses `<EffectComposer>` and `<Bloom>` from `@react-three/postprocessing`. Its peer `postprocessing` is pulled in automatically but pinning it explicitly avoids surprises.

**Files:**
- Modify: `client/package.json` (dependencies section)
- Modify: `client/pnpm-lock.yaml` (auto-updated by pnpm)

- [ ] **Step 1: Install the package**

Run from `client/`:
```bash
cd client && pnpm add @react-three/postprocessing postprocessing
```

- [ ] **Step 2: Verify the new dependencies appear in package.json**

Read `client/package.json` and confirm both `@react-three/postprocessing` and `postprocessing` are in `dependencies`.

- [ ] **Step 3: Verify install succeeded**

Run from `client/`:
```bash
pnpm ls @react-three/postprocessing postprocessing
```
Expected: both packages listed with resolved versions, no errors.

- [ ] **Step 4: Commit**

```bash
git add client/package.json client/pnpm-lock.yaml
git commit -m "Add @react-three/postprocessing for bloom effect"
```

---

## Task 3: Rename `ISSScene` to `ISSInteriorScene` and update its GLB path

Pure rename. Preserves all current behavior. The GLB path inside the component is updated from the old long filename to the new `iss-interior.glb`.

**Files:**
- Rename: `client/src/components/ISSScene.tsx` → `client/src/components/ISSInteriorScene.tsx`
- Modify: `client/src/app/page.tsx` (import path and component name)

- [ ] **Step 1: Rename the component file with git mv**

Run:
```bash
git mv client/src/components/ISSScene.tsx client/src/components/ISSInteriorScene.tsx
```

- [ ] **Step 2: Update the default export name and GLB path**

In `client/src/components/ISSInteriorScene.tsx`:

- On line 12, change:
  ```tsx
  const { scene } = useGLTF("/iss_interiorinternational_space_station.glb");
  ```
  to:
  ```tsx
  const { scene } = useGLTF("/iss-interior.glb");
  ```

- On line 42, change:
  ```tsx
  export default function ISSScene() {
  ```
  to:
  ```tsx
  export default function ISSInteriorScene() {
  ```

- [ ] **Step 3: Update the import in page.tsx**

Replace the entire contents of `client/src/app/page.tsx` with:

```tsx
"use client";

import dynamic from "next/dynamic";

const ISSInteriorScene = dynamic(() => import("@/components/ISSInteriorScene"), { ssr: false });

export default function Home() {
  return (
    <div className="h-screen w-screen">
      <ISSInteriorScene />
    </div>
  );
}
```

(Task 5 will replace this file again with the toggle version; this interim version exists so the app runs cleanly after this task's commit.)

- [ ] **Step 4: Verify the app still runs**

Run from `client/`:
```bash
pnpm dev
```
Open `http://localhost:3000`. Expected: interior scene renders exactly as before the rename. No console errors. Stop the dev server when confirmed.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/ISSInteriorScene.tsx client/src/app/page.tsx
git commit -m "Rename ISSScene to ISSInteriorScene and normalize GLB filename"
```

---

## Task 4: Create `ISSExteriorScene` component

New component. Loads `iss-exterior.glb`, replaces all mesh materials with a cyan wireframe `MeshBasicMaterial`, renders on a black background with orbit controls and a bloom post-processing pass.

**Files:**
- Create: `client/src/components/ISSExteriorScene.tsx`

- [ ] **Step 1: Create the component file**

Write to `client/src/components/ISSExteriorScene.tsx`:

```tsx
"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { Suspense, useEffect } from "react";
import * as THREE from "three";

function HologramModel() {
  const { scene } = useGLTF("/iss-exterior.glb");

  useEffect(() => {
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      const wireframe = new THREE.MeshBasicMaterial({
        wireframe: true,
        color: 0x00ffff,
        transparent: true,
        opacity: 0.9,
      });
      mats.forEach((mat) => mat.dispose());
      child.material = wireframe;
    });
  }, [scene]);

  return <primitive object={scene} />;
}

export default function ISSExteriorScene() {
  return (
    <Canvas camera={{ position: [0, 0, 30], fov: 50, near: 0.1, far: 1000 }}>
      <color attach="background" args={["#000000"]} />
      <Suspense fallback={null}>
        <HologramModel />
      </Suspense>
      <EffectComposer>
        <Bloom intensity={1.5} luminanceThreshold={0} mipmapBlur />
      </EffectComposer>
      <OrbitControls enableZoom enableDamping />
    </Canvas>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run from `client/`:
```bash
pnpm exec tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/ISSExteriorScene.tsx
git commit -m "Add ISSExteriorScene with wireframe hologram shader"
```

(The component is not mounted yet — Task 5 wires it in. Committing it now keeps the diff small and focused.)

---

## Task 5: Add view toggle to `page.tsx`

Replaces `page.tsx` with the two-scene toggle version. A fixed-position button switches between `interior` and `exterior`. Only one scene is mounted at a time.

**Files:**
- Modify: `client/src/app/page.tsx`

- [ ] **Step 1: Replace page.tsx with the toggle version**

Write to `client/src/app/page.tsx`:

```tsx
"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

const ISSInteriorScene = dynamic(() => import("@/components/ISSInteriorScene"), { ssr: false });
const ISSExteriorScene = dynamic(() => import("@/components/ISSExteriorScene"), { ssr: false });

type View = "interior" | "exterior";

export default function Home() {
  const [view, setView] = useState<View>("interior");

  const toggle = () => setView((v) => (v === "interior" ? "exterior" : "interior"));
  const label = view === "interior" ? "View Exterior" : "View Interior";

  return (
    <div className="h-screen w-screen relative">
      {view === "interior" ? <ISSInteriorScene /> : <ISSExteriorScene />}
      <button
        onClick={toggle}
        className="absolute top-4 right-4 z-10 px-4 py-2 font-mono text-sm text-white bg-black/50 border border-white/80 hover:bg-black/70 cursor-pointer"
      >
        {label}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run from `client/`:
```bash
pnpm exec tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/app/page.tsx
git commit -m "Add interior/exterior view toggle"
```

---

## Task 6: End-to-end verification in dev server

The most important task — this is where we confirm the feature actually works. Do not skip. Do not paraphrase the checklist. Actually run each step.

**Files:** none.

- [ ] **Step 1: Start the dev server**

Run from `client/`:
```bash
pnpm dev
```

Open `http://localhost:3000` in a browser.

- [ ] **Step 2: Verify the interior view**

Confirm:
- Interior ISS scene renders (cabin visible, lighting matches the pre-change behavior).
- No console errors in the browser devtools.
- Top-right of the screen shows a button labeled "View Exterior".

- [ ] **Step 3: Verify the toggle to exterior**

Click "View Exterior". Confirm:
- Scene changes to a black background with the ISS rendered as a cyan wireframe.
- Wires have a visible glow (bloom is active) — not just flat lines.
- Button label is now "View Interior".
- No console errors.

If the model is not visible, check browser console for `useGLTF` errors (wrong path, missing file) before anything else. If the model is visible but badly framed (too close, too far, off-center), adjust the camera `position` in `ISSExteriorScene.tsx` line 30 (start with larger Z like `[0, 0, 80]` if the model is too big; smaller like `[0, 0, 10]` if too small). Commit camera tweaks as a follow-up.

- [ ] **Step 4: Verify controls in exterior view**

- Click and drag: camera orbits around the model.
- Scroll wheel: camera zooms in/out.
- Drag should feel smooth (damping is on).

- [ ] **Step 5: Verify the toggle back to interior**

Click "View Interior". Confirm:
- Interior scene renders correctly again (same as Step 2).
- No accumulated console errors or warnings from the exterior unmount.
- Button label is now "View Exterior".

- [ ] **Step 6: Final check — lint and typecheck**

Run from `client/`:
```bash
pnpm exec tsc --noEmit && pnpm lint
```
Expected: both pass with no errors. If `pnpm lint` complains about the new files, fix inline before finishing.

- [ ] **Step 7: No commit needed for this task**

This task is verification-only. If any fixes were made during Step 3 (camera tuning) or Step 6 (lint), commit those as their own commit:

```bash
git add <file>
git commit -m "Tune exterior camera framing"   # or appropriate message
```

- [ ] **Step 8: Report completion**

Report to the user: feature works end-to-end, all six tasks complete, commits made. Ask whether to push to origin.
