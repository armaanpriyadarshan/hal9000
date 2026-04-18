"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { isCanonicalPart, SHIP_PARTS } from "@/lib/shipParts";

/**
 * Top-center DOM overlay for the currently-highlighted exterior part.
 * Guaranteed visible regardless of what goes on inside the Canvas
 * (bloom, Html portal quirks, etc.). Companion to the in-scene anchored
 * info card rendered inside <ISSExteriorScene>.
 */
export default function PartCaption() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const raw = searchParams.get("highlight");
  if (!isCanonicalPart(raw)) return null;
  const entry = SHIP_PARTS[raw];

  return (
    <div className="fixed top-hud-inset left-1/2 -translate-x-1/2 z-30 select-none">
      <div className="flex items-center gap-3">
        <div className="flex flex-col items-center leading-tight">
          <span className="font-mono uppercase tracking-[0.3em] text-[9px] text-white-dim">
            Highlighting
          </span>
          <span className="font-serif text-[28px] text-white mt-1 leading-none">
            {entry.displayName}
          </span>
        </div>
        <button
          type="button"
          onClick={() => router.push("/exterior")}
          className="font-mono text-[16px] leading-none text-white-dim hover:text-white"
          aria-label="Clear highlight"
        >
          ×
        </button>
      </div>
    </div>
  );
}
