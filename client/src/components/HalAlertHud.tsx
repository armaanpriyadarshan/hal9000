"use client";

import { useEffect, useState } from "react";

import { useHalAlerts } from "@/hooks/useHalAlerts";

/**
 * Judge-facing alert banner. Fixed bottom-center so it sits below the
 * four-corner ExteriorHud and PartCaption/InteriorCaption at the top.
 * Appears only once HAL has issued at least one proactive alert; stays
 * visible (not auto-fading) so reviewers can read after audio finishes.
 *
 * Style recipe — matches ExteriorHud exactly:
 *   - Mono uppercase labels with aggressive letter-spacing
 *   - Serif hero line for HAL's spoken text
 *   - Monochrome palette; opacity ladder carries hierarchy
 *   - Solid black card, hairline white border, no shadow/blur/rounding
 *   - Warning/emergency severities get the same ping-dot treatment as
 *     HalPill's monitoring indicator (no colour)
 */

const SEVERITY_LABEL: Record<string, string> = {
  advisory: "ADVISORY",
  caution: "CAUTION",
  warning: "WARNING",
  emergency: "EMERGENCY",
};

// These severities deserve the attention-grabbing ping. Everything
// else shows a static bullet so an advisory doesn't feel identical to
// a hull breach at a glance.
const PULSING = new Set(["warning", "emergency"]);


function useAlertAge(timestamp: number | null): string | null {
  // `timestamp` is a Python time.time() — seconds since epoch. The
  // server and client clocks may drift, but we only show coarse age
  // (NOW / Ns / M:SS), so a small skew doesn't matter.
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    if (timestamp === null) return;
    const id = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, [timestamp]);
  if (timestamp === null) return null;
  const age = Math.max(0, Math.floor(now - timestamp));
  if (age < 1) return "NOW";
  if (age < 60) return `${age}S`;
  const m = Math.floor(age / 60);
  const s = age % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}


export default function HalAlertHud() {
  const { lastAlert } = useHalAlerts();
  const age = useAlertAge(lastAlert?.timestamp ?? null);

  if (!lastAlert) return null;

  const severityLabel =
    SEVERITY_LABEL[lastAlert.severity] ?? lastAlert.severity.toUpperCase();
  const isPulsing = PULSING.has(lastAlert.severity);
  const moduleLabel = lastAlert.module
    ? lastAlert.module.toUpperCase().replace(/_/g, " ")
    : null;

  return (
    <div className="fixed bottom-hud-inset left-1/2 -translate-x-1/2 z-30 pointer-events-none select-none">
      <div className="bg-black border-[0.5px] border-white/50 px-5 py-3 min-w-[380px] max-w-[620px]">
        {/* Header row — severity, module, age. Mono small-caps with
            aggressive tracking, matching SectionHead in ExteriorHud. */}
        <div className="flex items-center gap-3 font-mono uppercase tracking-[0.22em] text-[9px] text-white-dim">
          <span className="relative flex h-1.5 w-1.5 items-center justify-center">
            {isPulsing && (
              <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-60 animate-ping" />
            )}
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
          </span>
          <span className="text-white">ALERT</span>
          <span className="text-white-faint">·</span>
          <span className="text-white">{severityLabel}</span>
          {moduleLabel && (
            <>
              <span className="text-white-faint">·</span>
              <span className="tracking-[0.18em]">{moduleLabel}</span>
            </>
          )}
          {age && (
            <span className="ml-auto text-white-faint tracking-[0.14em] tabular-nums">
              {age}
            </span>
          )}
        </div>

        {/* Primary line — what HAL actually said. Serif hero type
            matching DraggableCaption title size (18px). */}
        <div className="mt-2 font-serif text-[18px] leading-snug text-white">
          {lastAlert.text}
        </div>

        {/* Tertiary — where the alert came from. Tiny mono, dim. */}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono uppercase tracking-[0.14em] text-[8px] text-white-faint">
          <span>SOURCE · {lastAlert.source}</span>
          <span>GATE · {lastAlert.gate}</span>
        </div>
      </div>
    </div>
  );
}
