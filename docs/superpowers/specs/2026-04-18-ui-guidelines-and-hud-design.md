# UI Guidelines + Exterior HUD — Design

**Date:** 2026-04-18
**Status:** Approved design; ready for implementation planning
**Scope:** Establish a durable visual system for the HAL 9000 client and apply it across four concrete features — typography integration, a stronger glow on highlighted parts, a restyled part caption, and a simulated-telemetry HUD on the exterior view.

## Goal

Replace the ad-hoc tailwind classes scattered across the client with a documented design system. Ship four related visual changes that together transform the exterior view from "3D model in a black page" to "AI-controlled mission-control overlay":

1. Fonts: **EB Garamond** (serif display) + **JetBrains Mono** (HUD / caption / telemetry; all-caps by default).
2. Stronger highlight via post-process bloom.
3. Part captions restyled as **HUD bracket frames** (black bg, L-shape corners in white, no continuous border).
4. Simulated-telemetry **HUD corners** on the exterior view (mission / orbital / environmental / clock).

## Non-goals

- Interior view doesn't get the HUD in v1. Restricted to `/exterior`.
- No real ISS telemetry — all HUD values are plausible simulations. Real-telemetry integration is a future extension.
- No third body font. EB Garamond + JetBrains Mono cover everything; `font-sans` in Tailwind is aliased to mono so unstyled UI text is mono.
- No warning/error accent colors. Palette is strict black + white for UI chrome; hologram keeps its cyan internally.
- No visual companion / Storybook-style preview app. The UI guidelines doc is markdown + code snippets.
- No contextual metadata in the caption (e.g., "Zvezda · 19 t · 2000"). Caption stays a single line — display name only. Part metadata belongs in corner HUDs or a future detail panel.

## Background

Current state of the client's visual layer:
- No custom fonts loaded. Default browser fonts render body text.
- `client/src/app/globals.css` has a single body reset (black bg, grey text).
- Tailwind v4 is installed (`@import "tailwindcss"` + `@tailwindcss/postcss`).
- `@react-three/postprocessing` is already a dependency but unused.
- Existing part caption uses `text-cyan-200 … border border-cyan-400/40 rounded` — doesn't match the new direction.
- No design tokens exist; every UI element has its own colors/spacing/typography.

No design system documentation exists anywhere in `docs/`. The UI guidelines produced by this work will be a new file at `docs/ui/ui-guidelines.md` — the source of truth going forward.

## Architecture

Five units of work, each with a clear responsibility:

### 1. `docs/ui/ui-guidelines.md` (new — deliverable of this spec)

Durable design reference. Sections:

- **Typography:** font families (`font-serif` = EB Garamond, `font-mono` = JetBrains Mono), weights, usage rules, all-caps convention.
- **Colors:** `--color-black`, `--color-white`, `--color-white-dim` (0.4α), `--color-white-faint` (0.15α). Plus a callout that the hologram's cyan palette (`#72b8e0` / `#dcf0f8`) is hologram-only and must never appear in UI chrome.
- **Spacing tokens:** `--spacing-hud-inset: 1rem`, `--spacing-hud-gap: 0.5rem`. Standard Tailwind scale otherwise.
- **Component conventions:** the two named patterns: **Bracket frame** (four L-corner spans, no continuous border — used by caption AND HUD panels) and **HUD row** (faint label + white value pair).
- **Voice/tone of UI copy:** all caps for HUD labels; short abstract nouns (`ORBITAL ALT.`, `MISSION CLOCK`, `CABIN O₂`); no trailing punctuation; values include units.

### 2. Typography integration — `client/src/app/layout.tsx` + `client/src/app/globals.css`

`next/font/google` loads EB Garamond + JetBrains Mono at build time, exposes them as CSS variables, Tailwind v4 `@theme` in globals.css picks them up.

```ts
// layout.tsx
import { EB_Garamond, JetBrains_Mono } from "next/font/google";

const serif = EB_Garamond({
  subsets: ["latin"], weight: ["400", "500"], variable: "--font-serif",
});
const mono = JetBrains_Mono({
  subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono",
});
```

Both variables applied to `<html>`. `globals.css`:

```css
@import "tailwindcss";

@theme {
  --font-sans: var(--font-mono);
  --font-mono: var(--font-mono);
  --font-serif: var(--font-serif);
  --color-white-dim: rgba(255, 255, 255, 0.4);
  --color-white-faint: rgba(255, 255, 255, 0.15);
  --spacing-hud-inset: 1rem;
  --spacing-hud-gap: 0.5rem;
}

body {
  margin: 0;
  background: #000;
  color: #fff;
  overflow: hidden;
  font-family: var(--font-mono), ui-monospace, monospace;
}
```

**Meaningful choice:** `--font-sans` aliases to JetBrains Mono. Unstyled UI text defaults to mono, which is what the app wants. Serif is explicit opt-in (`font-serif`).

### 3. Bracket-frame component — `client/src/components/BracketFrame.tsx` (new)

Reusable black-bg + L-corner-brackets container. Used by the caption (inside `<Html>`) and by HUD panels.

```tsx
import type { ReactNode } from "react";

export function BracketFrame({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative bg-black ${className}`}>
      <span className="absolute -top-px -left-px h-2 w-2 border-t border-l border-white" />
      <span className="absolute -top-px -right-px h-2 w-2 border-t border-r border-white" />
      <span className="absolute -bottom-px -left-px h-2 w-2 border-b border-l border-white" />
      <span className="absolute -bottom-px -right-px h-2 w-2 border-b border-r border-white" />
      {children}
    </div>
  );
}
```

Consumer decides padding via `className`.

### 4. Glow bloom + caption restyle — `client/src/components/ISSExteriorScene.tsx`

Two edits:

**a. Bloom pass.** Wrap the scene content in `<EffectComposer>` + `<Bloom>` from `@react-three/postprocessing`:

```tsx
import { EffectComposer, Bloom } from "@react-three/postprocessing";

// inside <Canvas>, after <HologramModel />:
<EffectComposer>
  <Bloom intensity={1.4} luminanceThreshold={0.15} luminanceSmoothing={0.025} mipmapBlur />
</EffectComposer>
```

**b. Bump `highlightedMat` uniforms to HDR so bloom triggers:**

```ts
function makeMaterial(highlighted: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      baseColor: { value: new THREE.Color(0x72b8e0) },
      rimColor: {
        value: highlighted
          ? new THREE.Color(2.4, 2.8, 3.0)   // HDR — drives bloom
          : new THREE.Color(0xdcf0f8),
      },
      rimPower: { value: highlighted ? 1.4 : 2.5 },
      baseAlpha: { value: highlighted ? 0.85 : 0.2 },
      rimAlpha: { value: highlighted ? 1.0 : 0.9 },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    side: THREE.FrontSide,
    transparent: true,
    depthWrite: false,
  });
}
```

**c. Restyle caption** to use `BracketFrame`:

```tsx
{highlight && boxCenter && (
  <Html position={[boxCenter.x, boxCenter.y, boxCenter.z]} center distanceFactor={8}>
    <BracketFrame className="px-3 py-1.5">
      <div className="font-mono uppercase tracking-[0.15em] text-white text-xs whitespace-nowrap">
        {SHIP_PARTS[highlight].displayName}
      </div>
    </BracketFrame>
  </Html>
)}
```

The prior cyan-bordered caption goes away.

**Bump `HOLOGRAM_VERSION` again** (e.g., to `"fresnel-v3-hdr"`) because the uniform values changed — the userData-cached materials must re-run the initial-load effect on first mount.

### 5. Exterior corner HUD — `client/src/components/ExteriorHud.tsx` (new) + mount in `client/src/app/exterior/page.tsx`

Client component with `useEffect` + `setInterval` to tick at 1Hz, renders four `<HudPanel>` instances (each a `<BracketFrame>` with a column of `<HudRow>` pairs).

Content per corner:
- **Top-left (mission):** `EXPEDITION` = 73, `CALLSIGN` = HAL 9000, `MISSION DAY` = 001 + days-since-epoch.
- **Top-right (orbital):** `ORBITAL ALT.` ≈ 408 km drifting, `VELOCITY` ≈ 7.66 km/s drifting, `INCLINATION` = 51.64°.
- **Bottom-left (environmental):** `CABIN PRESS.` ≈ 101.3 kPa drifting, `O₂` ≈ 20.9% drifting, `CO₂` ≈ 4000 ppm drifting.
- **Bottom-right (clock):** `MISSION CLOCK` = `HH:MM:SS UTC` from local wall clock; `MET` (Mission Elapsed Time) = `DDD/HH:MM:SS` since mission epoch.

Drifting values use low-frequency `Math.sin`/`Math.cos` over `now` so they change visibly without being chaotic.

`HudRow` shape (uses the documented `text-white-dim` token, which Tailwind v4 auto-generates from the `@theme` `--color-white-dim` declaration):
```tsx
<div className="flex items-baseline gap-3 leading-tight">
  <span className="font-mono uppercase tracking-[0.12em] text-[10px] text-white-dim">
    {label}
  </span>
  <span className="font-mono uppercase tracking-[0.08em] text-xs text-white tabular-nums ml-auto">
    {value}
  </span>
</div>
```

`HudPanel` shape (per corner):
```tsx
<BracketFrame className="fixed [corner position] px-3 py-2 min-w-[180px] z-20 pointer-events-none">
  <div className="flex flex-col gap-1">{children}</div>
</BracketFrame>
```

Corner positions via Tailwind utilities using the CSS variable for inset:
- `top-[var(--spacing-hud-inset)] left-[var(--spacing-hud-inset)]` (top-left)
- `top-[var(--spacing-hud-inset)] right-[var(--spacing-hud-inset)]` (top-right)
- `bottom-[var(--spacing-hud-inset)] left-[var(--spacing-hud-inset)]` (bottom-left)
- `bottom-[var(--spacing-hud-inset)] right-[var(--spacing-hud-inset)]` (bottom-right)

Mount in `client/src/app/exterior/page.tsx` as a sibling of `<ISSExteriorScene />`.

## Data Flow

No server changes. No new API endpoints. All the visuals are client-only.

- Typography loads at build time (Next.js `next/font/google`).
- Bloom is entirely GPU — shader + post-process pass.
- HUD panels tick via a single `setInterval` on one component; all four corners derive from the shared `now` timestamp.
- Caption values come from `SHIP_PARTS` (existing) — no new data.

## Error Handling

| Failure | Detection | Behavior |
|---|---|---|
| Google Fonts unreachable at build time | Next.js build fails | Build fails loudly; no silent degradation. This is preferred — fonts are load-bearing for the whole design system. |
| EffectComposer unsupported (ancient GPU) | `@react-three/postprocessing` throws on init | Canvas falls back to rendering without bloom; highlighted meshes still brighter via uniforms alone. No crash. |
| `setInterval` leaks on unmount | Component cleanup | `useEffect` cleanup returns `clearInterval(id)`. Tested implicitly by navigation churn. |
| HUD covers canvas interaction | `pointer-events-none` on panels | Mouse/touch passes through to OrbitControls. Verified by orbiting with the mouse at a corner. |
| Vary-pitch system prefers reduced motion | CSS `prefers-reduced-motion` | Not addressed in v1. Values still tick at 1Hz regardless. Low priority — HAL runs for a specific demo, not arbitrary users. |

## Testing

**Automated tests — none.** No new server code; no client test infrastructure exists (plan proposed vitest-for-one-thing was rejected in prior features). The UI guidelines doc is prose.

**Manual acceptance:**

1. `/exterior` renders with all four corner HUD panels visible, each showing the expected labels.
2. Mission day, altitude, velocity, cabin pressure, O₂, CO₂, mission clock all visibly drift over 10 seconds.
3. Fonts: inspect an HUD label in devtools — `font-family` resolves to `JetBrains_Mono_...`. Inspect an EB Garamond test (temporarily render `<span className="font-serif">Test</span>` if needed) — resolves to `EB_Garamond_...`.
4. Trigger a highlight (`?highlight=service_module`). The matching meshes glow noticeably brighter than before — the glow extends beyond the mesh silhouette (bloom halo).
5. Caption reads `ZVEZDA SERVICE MODULE` in mono all-caps, on a black background, with four L-shaped white corner brackets. No continuous border.
6. Mouse-orbit the canvas by starting the drag inside an HUD panel's region — orbit should still work (panel is `pointer-events-none`).
7. Navigate `/exterior` → `/` → `/exterior`. HUD disappears on `/`, reappears on `/exterior`. No ghost HUD from the prior route.

**Visual acceptance (eyeball):**

- Does bloom make the highlight clearly stronger than the pre-change material bump?
- Does the caption's bracket treatment read as "HUD" and not as "unfinished border"?
- Are HUD panels legible at 1080p and scale reasonably at larger resolutions?
- Do the four corners feel balanced, or is one empty/overloaded?

## Open Questions

None blocking implementation. To revisit after landing:

- **Tune bloom intensity/threshold.** `1.4` and `0.15` are starting values; adjust by eye once live.
- **HUD inset on small viewports.** `--spacing-hud-inset: 1rem` may be too tight if viewport shrinks. Not addressed — HAL's screen is a specific size.
- **Real telemetry source.** When/if we want the HUD to reflect actual ship state (simulated elsewhere in the stack), the `<HudRow value={...}>` values come from that state instead of `Math.sin(now/…)`.
- **Extend HUD to interior view.** Probably appropriate (cabin-centric values — life support panels, module name), but out of scope here.
- **Future HUD-voice integration.** Could tie `<HudRow>` values to HAL's tool-calling (e.g., `get_telemetry(co2)` hits the HUD's underlying state). Large downstream design — deferred.
