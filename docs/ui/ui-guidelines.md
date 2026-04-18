# HAL 9000 Client — UI Guidelines

Source of truth for the visual system. Before adding UI, consult this doc; if you need something not here, extend the doc as part of the change.

## Typography

Two families. A third body font was intentionally skipped — the app has almost no prose.

### `font-serif` — EB Garamond

Weights 400, 500 (plus 400 italic). Loaded via `next/font/google` in `client/src/app/layout.tsx`, exposed as the CSS variable `--font-serif` and the Tailwind utility `font-serif`.

Usage: display, hero, narrative moments that want gravitas. Rare. If you're reaching for it, ask whether the content belongs in text at all or in an HUD label.

### `font-mono` — JetBrains Mono

Weights 400, 500. Loaded via `next/font/google`, exposed as the CSS variable `--font-mono` and the Tailwind utility `font-mono`.

Usage: HUD, captions, telemetry, spoken-text surfaces (if we add them), any label that reads as technical. This is the default for the app — `--font-sans` aliases to `--font-mono` via `@theme`, so any unstyled text lands in JetBrains Mono.

**All-caps convention.** HUD labels, caption text, and short tags render in all caps. Compose via `uppercase tracking-[0.12em]` (labels) or `uppercase tracking-[0.15em]` (caption headings). Long-form text does not get uppercased.

## Colors

Strict monochrome for UI chrome. The hologram's cyan palette lives on the 3D scene only.

### Tokens

| Token | Value | Use |
|---|---|---|
| `--color-black` | `#000` | All UI backgrounds. The app background is pure black. |
| `--color-white` | `#fff` | Primary UI text, primary borders, strong emphasis. |
| `--color-white-dim` | `rgba(255, 255, 255, 0.4)` | Secondary text (labels above values in HUD rows), inactive borders. |
| `--color-white-faint` | `rgba(255, 255, 255, 0.15)` | Tertiary markers — tick marks, prefix indicators, dividers. |

Registered in `client/src/app/globals.css` via `@theme`. Tailwind v4 auto-generates utilities: `text-white-dim`, `bg-white-dim`, `border-white-faint`, etc. Prefer those over raw `text-white/40`-style shorthands so grep-driven refactors work.

### Hologram colors (off-limits for UI)

The 3D hologram shader uses `#72b8e0` (base) and `#dcf0f8` (rim, default state) / HDR `rgb(2.4, 2.8, 3.0)` (rim, highlighted state). These are shader uniforms — they never appear in DOM UI.

## Spacing

Standard Tailwind spacing scale applies. Two HUD-specific tokens in `@theme`:

| Token | Value | Use |
|---|---|---|
| `--spacing-hud-inset` | `1rem` | Distance from viewport edges to corner HUD panels. Tailwind utilities: `top-hud-inset`, `left-hud-inset`, etc. |
| `--spacing-hud-gap` | `0.5rem` | Padding inside an HUD panel (reserved for future use; most panels use `px-3 py-2` directly today). |

## Component Conventions

Two named patterns that most UI surfaces reuse.

### Bracket frame

Four L-shaped white corner brackets around a black background, no continuous border. Used by the part caption (inside the 3D scene via drei's `<Html>`) AND by the corner HUD panels.

Implemented as `client/src/components/BracketFrame.tsx`. Consumer controls padding via `className`:

```tsx
<BracketFrame className="px-3 py-1.5 pointer-events-none">
  <div className="font-mono uppercase tracking-[0.15em] text-white text-xs">
    ZVEZDA SERVICE MODULE
  </div>
</BracketFrame>
```

Rules:
- Always black background.
- Always white corner marks (1px stroke, 8px long).
- Never add a continuous border. If you want one, you're picking the wrong frame.

### HUD row

Label + value pair, used inside HUD panels. Label is faint uppercase mono; value is white uppercase mono with tabular numerals. Shape:

```tsx
<div className="flex items-baseline gap-3 leading-tight">
  <span className="font-mono uppercase tracking-[0.12em] text-[10px] text-white-dim">
    ORBITAL ALT.
  </span>
  <span className="font-mono uppercase tracking-[0.08em] text-xs text-white tabular-nums ml-auto">
    408.3 KM
  </span>
</div>
```

Live on `client/src/components/ExteriorHud.tsx` as the `HudRow` helper.

## Voice / Tone of UI Copy

Labels and short tags use the following style:

- **ALL CAPS** for any HUD label, caption heading, or status tag.
- **Short abstract nouns**, not sentences: `ORBITAL ALT.`, `MISSION CLOCK`, `CABIN O₂`, `EXPEDITION`. Period after abbreviations when truncated.
- **No trailing punctuation** on bare labels (`EXPEDITION`, not `EXPEDITION:`).
- **Values carry units** inline: `408.3 KM`, `7.660 KM/S`, `20.92 %`, `04:17:36 UTC`.
- **Abbreviations** follow NASA/aerospace convention when one exists: `ALT.` for altitude, `PRESS.` for pressure, `UTC` not `GMT`, `MET` for Mission Elapsed Time.
- **Don't abbreviate** content text — prefer "Zvezda Service Module" over "Zvezda SM" in the caption.

## Layout / Z-index

| Layer | Value | Content |
|---|---|---|
| Canvas (3D) | `z-0` (implicit) | ISS hologram, stars. |
| HAL orb | `z-10` | `HalVoice` visualiser at bottom-center. |
| HUD panels | `z-20` | Corner telemetry panels on `/exterior`. |
| (future) Toasts/modals | `z-30+` | Reserved. |

All HUD overlays use `pointer-events-none` by default so 3D-canvas interaction (orbit, zoom) passes through.

## Applying / Extending

- New font? Update this doc's Typography section first, then `layout.tsx` + `@theme`.
- New color? Add a token row above, register in `@theme`, prefer using the token utility in consumers.
- New surface? Decide: can it use `BracketFrame` + `HudRow`? Usually yes. If not, write a new section here describing the new pattern before landing the code.
- Long-form prose surface (e.g., a settings page)? Add a sans body font (Inter or Geist Sans), update this doc.
