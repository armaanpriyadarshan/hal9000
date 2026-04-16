# Holographic ISS Exterior View — Design

**Date:** 2026-04-16
**Status:** Approved for implementation planning

## Goal

Add a second full-screen scene showing the exterior ISS model rendered as a holographic wireframe. The user can switch between the existing interior view and the new exterior view via a toggle button. Only one scene is mounted at a time.

## Non-goals

- Animated transitions between views.
- Interactive hotspots or annotations on the hologram.
- Mobile-specific tuning.
- Route-based navigation (no `/interior`, `/exterior` URLs).
- Server-side rendering of the 3D scenes.

## File layout

```
client/
├── public/
│   ├── iss-interior.glb              (existing interior; renamed shorter)
│   └── iss-exterior.glb              (new; source: ~/Downloads/international_space_station_-_iss.glb)
├── src/
│   ├── app/page.tsx                  (holds view state + toggle button)
│   └── components/
│       ├── ISSInteriorScene.tsx      (current ISSScene.tsx, renamed)
│       └── ISSExteriorScene.tsx      (new)
```

The current GLB filename (`iss_interiorinternational_space_station.glb`) is renamed to `iss-interior.glb` for consistency with the new `iss-exterior.glb`. The reference in `ISSInteriorScene.tsx` is updated accordingly.

## Components

### `page.tsx` (parent)

- Local state `const [view, setView] = useState<"interior" | "exterior">("interior")`.
- Conditionally renders exactly one of `<ISSInteriorScene />` or `<ISSExteriorScene />`. The other is unmounted so its Canvas / three.js resources are fully released.
- Renders a fixed-position toggle button, top-right corner, `z-index` above the Canvas.
- Button label flips: "View Exterior" when on interior, "View Interior" when on exterior.
- Minimal styling: 1px white border, translucent black background (`rgba(0,0,0,0.5)`), monospace font, small padding. Matches the sci-fi aesthetic without competing with the hologram.

### `ISSInteriorScene.tsx`

- Rename of the current `ISSScene.tsx`. No behavior changes beyond the GLB path update (`/iss_interiorinternational_space_station.glb` → `/iss-interior.glb`).

### `ISSExteriorScene.tsx` (new)

Structure:

```tsx
<Canvas camera={{ position: [0, 0, 30], fov: 50, near: 0.1, far: 1000 }}>
  <color attach="background" args={["#000"]} />
  <Suspense fallback={null}>
    <HologramModel />
  </Suspense>
  <EffectComposer>
    <Bloom intensity={1.5} luminanceThreshold={0} mipmapBlur />
  </EffectComposer>
  <OrbitControls enableZoom enableDamping />
</Canvas>
```

`HologramModel`:

- Loads `/iss-exterior.glb` via `useGLTF`.
- In `useEffect`, traverses the scene. For each `THREE.Mesh`, disposes the original material(s) and replaces with:
  ```
  new THREE.MeshBasicMaterial({
    wireframe: true,
    color: 0x00ffff,
    transparent: true,
    opacity: 0.9,
  })
  ```
- Handles both single-material and material-array cases (same pattern as existing `ISSInteriorScene`).
- Returns `<primitive object={scene} />`.

No lights, no environment map — the hologram is deliberately unlit; `MeshBasicMaterial` is unshaded and bloom handles the glow.

## Interaction

| Action | Interior view | Exterior view |
|---|---|---|
| Drag | Look around (existing behavior) | Orbit camera around model |
| Scroll | Disabled | Zoom in/out |
| Pan | Disabled | Disabled |
| Toggle button | Switch to exterior | Switch to interior |

## Dependencies

Add to `client/package.json`:

- `@react-three/postprocessing` — provides `<EffectComposer>` and `<Bloom>` as R3F components.
- `postprocessing` — peer dependency of the above.

Already present: `three`, `@react-three/fiber`, `@react-three/drei`.

## Asset setup

The `client/public/` directory does not currently exist on disk, and the interior GLB referenced by the existing code (`/iss_interiorinternational_space_station.glb`) is also not present locally. As part of this change:

1. Create `client/public/`.
2. Copy `~/Downloads/iss_interiorinternational_space_station.glb` to `client/public/iss-interior.glb`.
3. Copy `~/Downloads/international_space_station_-_iss.glb` to `client/public/iss-exterior.glb`.

GLB files are not gitignored, so whether to commit them is a separate decision — flag to the user at commit time given the 24MB + 37MB sizes.

## Risks and open questions

- **Camera framing.** Initial camera position `[0, 0, 30]` with `fov: 50` is a guess. Verify on first render and tune. The model's natural scale and origin are unknown until loaded.
- **Bloom performance.** `mipmapBlur` is higher quality but more expensive. If framerate suffers, fall back to default (non-mipmap) bloom or reduce intensity.
- **Wireframe density.** GLBs with high-poly meshes can produce visually noisy wireframes. If the exterior model is too dense to read clearly, escalate to the deferred "custom ShaderMaterial" approach — not in scope for this spec.
- **Next.js caveats.** `client/AGENTS.md` warns this Next.js version has breaking changes from training data and directs to consult `node_modules/next/dist/docs/` before writing code. This feature stays within client components and standard React/R3F patterns, so the risk is low, but the implementation plan should include a docs sanity-check step.

## Testing

No unit tests — this is a visual feature.

Verification checklist:

1. `pnpm dev` starts without errors.
2. Page loads with the interior view rendering as before the change.
3. Toggle button is visible in the top-right corner.
4. Clicking the button unmounts the interior scene and mounts the exterior scene.
5. Exterior view shows the ISS as a glowing cyan wireframe on a black background, with visible bloom glow on the wires.
6. Drag rotates the camera; scroll zooms.
7. Clicking the button again returns to the interior view, which still works correctly (no leaked three.js state, no console errors).
8. No TypeScript errors (`pnpm tsc --noEmit` or equivalent).
9. No console warnings beyond pre-existing ones.
