"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { DraggableCaption } from "@/components/hud/DraggableCaption";
import { INTERIOR_AREAS, isCanonicalArea } from "@/lib/interiorAreas";

/**
 * Two DOM overlays for the current interior destination:
 *
 * - Top-center banner: "NOW AT <displayName>" — mirrors PartCaption's
 *   language but swaps the verb ("Highlighting" → "Now at").
 * - Mid-right card: reuses DraggableCaption. Close-X clears the ?area=
 *   param, which teleports back to the startup pose.
 *
 * Mounts outside the Canvas so it never fights <Html> portals. Both
 * overlays are gated on a valid canonical area; an unknown area param
 * renders nothing.
 */
export default function InteriorCaption() {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get("area");
  const area = isCanonicalArea(raw) ? raw : null;

  // Reset the draggable offset every time the destination changes, so a
  // fresh flight always lands the card in its default anchor position.
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  useEffect(() => {
    setOffset({ x: 0, y: 0 });
  }, [area]);

  if (!area) return null;
  const entry = INTERIOR_AREAS[area];

  const risk = params.get("risk");
  const classLabel = risk
    ? ({
        emergency: "CLASS 1 · EMERGENCY",
        warning: "CLASS 2 · WARNING",
        caution: "CLASS 3 · CAUTION",
        advisory: "CLASS 4 · ADVISORY",
      } as Record<string, string>)[risk] ?? null
    : null;
  const urgent = risk === "emergency" || risk === "warning";

  return (
    <>
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
            {classLabel ? "Affected" : "Now at"}
          </span>
          <span className="font-serif text-[28px] text-white mt-1 leading-none">
            {entry.displayName}
          </span>
        </div>
      </div>
      <div className="fixed top-1/2 right-hud-inset -translate-y-1/2 z-30 w-[220px] h-0">
        <DraggableCaption
          offset={offset}
          onOffsetChange={setOffset}
          kind={entry.kind}
          name={entry.displayName}
          description={entry.description}
          onClose={() => router.push("/")}
        />
      </div>
    </>
  );
}
