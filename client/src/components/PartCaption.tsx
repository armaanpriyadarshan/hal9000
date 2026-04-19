"use client";

import { useSearchParams } from "next/navigation";
import { isCanonicalPart, SHIP_PARTS } from "@/lib/shipParts";

/**
 * Top-center DOM overlay for the currently-highlighted exterior part.
 * Guaranteed visible regardless of what goes on inside the Canvas
 * (bloom, Html portal quirks, etc.). Companion to the in-scene anchored
 * info card rendered inside <ISSExteriorScene>. The in-scene card owns
 * the close-X affordance; this banner is purely a title strip.
 *
 * When `?risk=<severity>` is present (proactive-alert auto-focus),
 * prepends an ISS C&W severity pill so the text banner communicates
 * threat alongside the scene's Fresnel colour swap.
 */

const CLASS_LABEL: Record<string, string> = {
  emergency: "CLASS 1 · EMERGENCY",
  warning:   "CLASS 2 · WARNING",
  caution:   "CLASS 3 · CAUTION",
  advisory:  "CLASS 4 · ADVISORY",
};

// Warm-red accent echoes halVisualizer palette — Class 1/2 pop off
// the monochrome banner. Class 3/4 stay white-dim so routine alerts
// don't visually scream.
const URGENT = new Set(["warning", "emergency"]);

export default function PartCaption() {
  const searchParams = useSearchParams();
  const raw = searchParams.get("highlight");
  if (!isCanonicalPart(raw)) return null;
  const entry = SHIP_PARTS[raw];
  const risk = searchParams.get("risk");
  const classLabel = risk ? CLASS_LABEL[risk] ?? null : null;
  const urgent = risk ? URGENT.has(risk) : false;

  return (
    <div className="pointer-events-none fixed top-hud-inset left-1/2 -translate-x-1/2 z-30 select-none">
      <div className="flex flex-col items-center leading-tight">
        {classLabel && (
          <span
            className="font-mono uppercase tracking-[0.3em] text-[9px] mb-1"
            style={{ color: urgent ? "rgb(255, 120, 80)" : undefined }}
          >
            ● {classLabel}
          </span>
        )}
        <span className="font-mono uppercase tracking-[0.3em] text-[9px] text-white-dim">
          {classLabel ? "Affected" : "Highlighting"}
        </span>
        <span className="font-serif text-[28px] text-white mt-1 leading-none">
          {entry.displayName}
        </span>
      </div>
    </div>
  );
}
