# Exterior Part Highlight + Camera — Design

**Date:** 2026-04-18
**Status:** Approved design; ready for implementation planning
**Scope:** Tier 1 (shader glow + label) and Tier 2 (camera orbit to face) of the "HAL knows the ship" capability, limited to the exterior view.

## Goal

Let HAL point at parts of the station on the exterior view. When the crew asks to see the Zvezda service module or the solar arrays, HAL calls `highlight_part`; the exterior scene glows the matching meshes, frames them in camera, and floats a label. If the user is on the interior, calling `highlight_part` auto-navigates to exterior first.

## Non-goals

- Interior navigation / highlighting — separate design, after this lands.
- Multi-part highlights in a single call (`highlight_parts(["a", "b"])`). Framework supports it via dispatch; wait for a real need.
- `clear_highlight` tool. New highlight replaces the old; navigating to interior clears automatically. Add later if the UX demands an explicit clear.
- Status overlays / simulated damage / description voicing — Tier 3, out of scope.
- Server-side part registry shared with client via JSON. Rejected as over-engineering for a 7-entry registry.

## Background

Inspection of `client/public/iss-exterior.glb` (done during brainstorming):

- 669 nodes, 327 meshes, 1 material — the existing `HologramModel` in `ISSExteriorScene.tsx:86-88` overwrites every mesh's material with a single shared fresnel `ShaderMaterial`.
- Mesh names are obfuscated (`p6_ani_000_51_phongE1_0`, `sm_ext_sm_000_3_phongE1_0`). **Arbitrary part addressing is not possible.**
- But two reliable addressing primitives exist:
  - **Named parent nodes:** `ISS`, `PAINEIS` (solar panels), `MODULO1`/`MODULO2` (pressurised modules), `hall`, a handful of others. Descendants of these are stable logical groupings.
  - **Mesh-name prefixes** that map to real ISS sections: `sm_ext_sm` (60 meshes → Zvezda service module), `p6_ani` (26 → P6 truss), `s0_ani` (29 → S0 truss), `esp2_lo` (19 → ESP2 stowage), `ESP3` (5 → ESP3 stowage), `AMS2` (3 → AMS-2 experiment).

The registry design is built on these two match kinds.

## Architecture

### Server-side — `server/tools.py` extension

Add a second `ToolSpec` to `TOOL_SPECS`:

- `name`: `"highlight_part"`
- `parameters`: JSON schema with a single required `part` string, enum of 7 canonical names (below).
- `description`: prose listing all aliases per canonical name, so Gemma maps natural phrasing ("Zvezda", "solar panels", "backbone") to the right enum value. Description is the only place aliases live — the enum stays canonical-only.
- `location`: `"client"`.
- `handler`: `None` (no server work — it's a client effect).
- `ack_template`: `"Highlighting the {part}."` as the v1 line. The snake_case may read awkwardly spoken ("service_module"); if so, swap to a generic line like `"Highlighting that section."`. Low-cost to iterate.

### Client-side — new `client/src/lib/shipParts.ts`

Source of truth for the 7 parts. Typed as:

```ts
type Match =
  | {kind: "prefix"; values: string[]}   // mesh.name starts with ANY value
  | {kind: "parent"; values: string[]};  // mesh is a descendant of ANY named ancestor

type PartEntry = {
  displayName: string;
  match: Match;
  cameraOffset: [number, number, number];   // direction vector; camera sits at center + normalized(offset) * diag * scale
  cameraDistanceScale?: number;              // default 1.8
};

export const CANONICAL_PARTS = [
  "solar_arrays", "service_module", "p6_truss", "s0_truss",
  "external_stowage", "ams_experiment", "main_modules",
] as const;

export const SHIP_PARTS: Record<typeof CANONICAL_PARTS[number], PartEntry> = { ... };
```

Initial entries:

| Canonical name       | displayName                  | Match                                           |
|----------------------|-----------------------------|-------------------------------------------------|
| `solar_arrays`       | "Solar Arrays"               | `{kind: "parent",  values: ["PAINEIS"]}`        |
| `service_module`     | "Zvezda Service Module"      | `{kind: "prefix",  values: ["sm_ext_sm"]}`      |
| `p6_truss`           | "P6 Truss"                   | `{kind: "prefix",  values: ["p6_ani"]}`         |
| `s0_truss`           | "S0 Truss"                   | `{kind: "prefix",  values: ["s0_ani"]}`         |
| `external_stowage`   | "External Stowage Platforms" | `{kind: "prefix",  values: ["esp2_lo", "ESP3"]}`|
| `ams_experiment`     | "AMS-2 Experiment"           | `{kind: "prefix",  values: ["AMS2"]}`           |
| `main_modules`       | "Main Modules"               | `{kind: "parent",  values: ["MODULO1", "MODULO2"]}`|

An optional 8th — `radiators` — added during implementation only if meshes can be isolated from the truss hierarchy. If not, drop.

`cameraOffset` and `cameraDistanceScale` values are tuned by eye during implementation. Starting guess: `cameraOffset: [1, 0.2, 1]`, scale `1.8`.

### Client-side — modified `client/src/lib/halTools.ts`

Add one handler:

```ts
highlight_part: (args, { router }) => {
  const part = typeof args.part === "string" ? args.part : "";
  if (!part) return;
  router.push(`/exterior?highlight=${encodeURIComponent(part)}`);
},
```

Works whether we're already on `/exterior` (Next.js re-runs `useSearchParams()` in-place) or on `/` (full navigation, scene mounts with the highlight already in URL). Existing `set_view` handler stays untouched.

### Client-side — modified `client/src/components/ISSExteriorScene.tsx`

Reads `useSearchParams().get("highlight")` directly inside `ISSExteriorScene`, passes it to `HologramModel` as a prop (no changes needed in `client/src/app/exterior/page.tsx`). `HologramModel`:

1. **On mount + on highlight change:** resolves matching meshes via the registry rule.
   - For `kind: "parent"`: `scene.getObjectByName(name)` for each value, collect descendants.
   - For `kind: "prefix"`: traverse scene, include meshes where any `prefix` is a `name.startsWith()` match.
2. Two shared `ShaderMaterial` instances live at module scope: `defaultMat` (current fresnel) and `highlightedMat` (same shader, brighter uniforms — `baseAlpha: 0.55`, `rimAlpha: 1.0`, shifted rim color). On highlight change, every mesh in the scene is routed to one or the other.
3. Edge-line `LineSegments` children are left untouched — already bright; boosting them oversaturates.
4. Compute `Box3` spanning the matching meshes; derive `targetCenter`, `targetPos` = `center + normalize(cameraOffset) * diag * scale`.
5. Start a camera lerp: store `{startPos, startTarget, endPos: targetPos, endTarget: targetCenter, t0: now()}` in a ref. A `useFrame` hook eases with `easeInOutCubic` for 1.2s, applying to `camera.position` and `controls.target`. New highlight mid-lerp resets from the current camera state.
6. Render `<Html position={boxCenter} center distanceFactor={8}>{displayName}</Html>` from `@react-three/drei`. Styled as a subtle HUD panel matching the hologram aesthetic.

No highlight (`null`) ⇒ all meshes on `defaultMat`, no label, no camera animation.

## Data Flow (one turn)

```
Browser                       Server                              Cactus/Gemma
───────                       ──────                              ────────────
[user says]
"HAL, show me Zvezda"
POST /api/voice ──────────►   run_turn(pcm) ──── tools ─────────► set_view/highlight_part
                                                                  available
                              ◄── function_calls = [{
                                    name: "highlight_part",
                                    arguments: {part: "service_module"}
                                  }]
                              dispatch() validates enum → OK
                              ack = "Highlighting the service_module."
                              tts(ack)
                          ◄── {reply, audio, client_directives: [...]}
◄───────────────────
executeClientDirectives:
  highlight_part → router.push("/exterior?highlight=service_module")

(If user was on interior, scene unmounts and exterior mounts.)

ISSExteriorScene:
  useSearchParams().get("highlight") → "service_module"
  HologramModel:
    resolve meshes via SHIP_PARTS.service_module.match
      → scene.traverse, collect mesh.name.startsWith("sm_ext_sm")
    route matches to highlightedMat, rest to defaultMat
    compute Box3, targetPos, start camera lerp
    render <Html> label at box center

playReplyAudio(audio)  // HAL speaks the ack
```

Key notes:
- `highlight_part` and `set_view` are independent tools. The auto-nav in `highlight_part`'s handler handles the common case (interior → exterior) without asking Gemma to chain two tool calls.
- URL is the state. `http://localhost:3000/exterior?highlight=service_module` is a shareable debug link and the same as the voice-driven state.
- Glb load is async; the effect that resolves meshes is keyed on `[scene, highlight]`, so it fires once both are ready regardless of order.

## Error Handling

| Failure | Detection | Behavior |
|---|---|---|
| Gemma emits invalid `part` enum value | Existing `jsonschema.validate` in `dispatch()` | Generic error ack, no directive (existing framework path) |
| Canonical `part` resolves to zero meshes (registry bug or glb drift) | Client: matching set empty after resolve | `console.warn`; navigate completes but skip highlight — no material swap, no label, no camera lerp |
| Highlight fired before glb loaded | `useEffect([scene, highlight])` gating | Runs automatically when scene resolves |
| Rapid successive highlights mid-lerp | New effect run resets `startPos` to current camera position | Smooth restart from wherever the camera currently is |
| User manually types `/exterior?highlight=cupola` | Registry lookup returns `undefined` | Treated as `null` — no highlight, normal scene |
| Navigating `/exterior` → `/` → `/exterior` | Second `/exterior` loads without `?highlight=` | Intentional — fresh state, re-query to highlight again |

## Testing

### Server-side — one new test

In `server/tests/test_tools.py`:

- Assert `highlight_part` is in `TOOL_SPECS`, with the enum exactly `["solar_arrays", "service_module", "p6_truss", "s0_truss", "external_stowage", "ams_experiment", "main_modules"]` (hardcoded in the test, updated when the registry changes).
- Optionally assert the tool description mentions every canonical name once (cheap catch for description drift).

### Client-side — no automated tests

Consistent with the existing framework v1. `shipParts.ts` is pure data + small functions; the value of setting up vitest for it is low. The cross-wire sync is protected by the server-side enum assertion plus a comment in both files pointing at the other.

### Cactus integration — manual only

Same reason as before — model behavior is slow and non-deterministic on CPU.

### Acceptance test (user-driven)

1. From `/`, say *"HAL, show me the solar arrays."* → navigates to `/exterior`; solar-array meshes glow brighter; camera lerps to frame them; floating label *"Solar Arrays"* appears near the arrays.
2. From `/exterior`, say *"Now show me the Russian module."* → highlight swaps to the Zvezda meshes; label changes to *"Zvezda Service Module"*; camera lerps.
3. Say *"Show me the backbone."* → s0_truss activates (the "backbone" alias lives in the tool description).
4. Say *"Show me the cupola."* → not in enum; HAL speaks *"I am unable to comply with that request, Ethan."*; visual state unchanged.
5. Say *"Let me see inside."* → navigates to `/`; exterior unmounts; highlight state gone.
6. Manually visit `http://localhost:3000/exterior?highlight=ams_experiment` → AMS-2 highlights, label, camera framed. Confirms URL-as-state works independently of the voice path (useful for debugging).

## Open Questions

None blocking. To revisit during or after implementation:

- **Ack phrasing.** If `"Highlighting the service_module."` reads awkwardly spoken, change to a generic line or thread display names through dispatch (small dispatch change).
- **Radiators entry.** Decide during implementation if the meshes can be cleanly isolated from the truss hierarchy.
- **Camera offset tuning.** Starting values are eye-balled; tune once the scene is live.
- **Alias quality for Gemma.** If the model consistently misses a natural phrase ("show me the wings" → no match), extend the description; if it keeps hallucinating parts not in the enum, tighten the nudge in `SYSTEM_PROMPT`.
