"use client";

import { useSearchParams } from "next/navigation";
import { isCanonicalPart, SHIP_PARTS } from "@/lib/shipParts";

/**
 * DOM-level caption for the currently-highlighted exterior part. Reads
 * the same `highlight` search param the scene uses and renders a fixed
 * banner at the top-center of the viewport. Lives outside the Canvas so
 * EffectComposer / Bloom / Html-portal quirks can't swallow it.
 */
export default function PartCaption() {
  const searchParams = useSearchParams();
  const raw = searchParams.get("highlight");
  if (!isCanonicalPart(raw)) return null;
  const entry = SHIP_PARTS[raw];

  return (
    <div className="pointer-events-none fixed top-hud-inset left-1/2 -translate-x-1/2 z-20 select-none">
      <div className="flex flex-col items-center leading-tight">
        <span className="font-mono uppercase tracking-[0.3em] text-[9px] text-white-dim">
          Highlighting
        </span>
        <span className="font-serif text-[28px] text-white mt-1">
          {entry.displayName}
        </span>
      </div>
    </div>
  );
}
