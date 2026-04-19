"use client";

import { useEffect, useRef, useState } from "react";

import { defaultServerUrl } from "@/lib/halAudio";
import { useHalAlerts } from "@/hooks/useHalAlerts";


/**
 * Fire /api/debug/full_reset once, synchronously on the first mount
 * after a page RELOAD (F5 / Cmd+Shift+R / Cmd+R). Normal in-app
 * navigations (router.push, back button) are NOT reloads and don't
 * trigger a reset — only a deliberate refresh does.
 *
 * Lives inside HalAlertHud because that component is mounted on
 * both audience routes (/ and /exterior) and NOT on /ops, so the
 * operator can refresh their console without wiping the demo state.
 */
const RESET_DONE = new Set<string>();  // in-module dedup against StrictMode

function useResetOnHardReload() {
  const hasRun = useRef(false);
  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;
    if (typeof window === "undefined") return;

    // performance.getEntriesByType("navigation") returns the
    // PerformanceNavigationTiming for the current document. .type
    // distinguishes "navigate" (link, router.push) from "reload"
    // (F5 / Cmd+R / Cmd+Shift+R). Only the latter should reset.
    const entries = performance.getEntriesByType("navigation");
    const nav = entries[0] as PerformanceNavigationTiming | undefined;
    if (!nav || nav.type !== "reload") return;

    // Module-level dedup so React 18/19 Strict-Mode double-invoke
    // can't fire this twice. Keyed by document origin which is
    // stable within a single browser tab.
    const key = window.location.origin + window.location.pathname;
    if (RESET_DONE.has(key)) return;
    RESET_DONE.add(key);

    // Clear client-side persistence too so the banner doesn't
    // resurrect a stale alert the next tick.
    try {
      window.sessionStorage.removeItem("hal9000.lastAlert");
    } catch {
      /* quota / disabled — not fatal */
    }

    // Fire the server reset — fire-and-forget.
    fetch(`${defaultServerUrl()}/api/debug/full_reset`, { method: "POST" })
      .catch(() => {
        /* ignore; refresh will retry on next reload */
      });
  }, []);
}

/**
 * Judge-facing alert banner. Fixed bottom-center, below the four-corner
 * ExteriorHud and above the 3D canvas. Appears only after HAL has
 * issued at least one proactive alert; persists until the next one.
 *
 * Severity → visual language follows the ISS Caution & Warning (C&W)
 * class system:
 *   - Class 1 · Emergency  — fire, rapid depressurization, toxic
 *     atmosphere, O2 depletion. Red accents (HAL visualizer warm
 *     palette) + pulsing dot + threat name highlighted.
 *   - Class 2 · Warning    — loss of critical-system redundancy.
 *     Monochrome, pulsing dot.
 *   - Class 3 · Caution    — off-nominal trend, non-urgent.
 *     Monochrome static dot.
 *   - Class 4 · Advisory   — status info, sub-alarm drift.
 *     Monochrome dim dot.
 *
 * Monochrome is the rule for every severity except Class 1, where the
 * warm red is the single emotional-colour exception — consistent with
 * the halVisualizer eye/ring which carries the same palette.
 */

// Real ISS C&W classes. Renders alongside the severity label so
// judges see the familiar ISS flight-ops vocabulary.
const CLASS_LABEL: Record<string, string> = {
  emergency: "CLASS 1",
  warning: "CLASS 2",
  caution: "CLASS 3",
  advisory: "CLASS 4",
};

const SEVERITY_LABEL: Record<string, string> = {
  advisory: "ADVISORY",
  caution: "CAUTION",
  warning: "WARNING",
  emergency: "EMERGENCY",
};

// Emergency event_id / name → ISS threat-name. Matches NASA's C&W
// tone vocabulary (fire / rapid depress / toxic atmosphere). When an
// emergency fires, the threat name replaces the module label in the
// header for the familiar on-orbit readout.
//
// Looked up by alert.event_id first, then alert.name — so both
// observer threshold rules (event_id = "threshold:rapid_depress")
// and operator-fired scenarios from the ops panel (name =
// "rapid_depress") render with the same threat label.
const THREAT_NAME: Record<string, string> = {
  "threshold:rapid_depress":        "RAPID DEPRESS",
  "rapid_depress":                  "RAPID DEPRESS",
  "threshold:po2_critical":         "ATMOSPHERE · O2 DEPLETION",
  "po2_critical":                   "ATMOSPHERE · O2 DEPLETION",
  "cabin_fire":                     "FIRE",
  "toxic_atmosphere":               "TOXIC ATMOSPHERE · NH3",
  "toxic_atmosphere_nh3":           "TOXIC ATMOSPHERE · NH3",
};

// Class 1 + Class 2 get the attention-grabbing ping.
const PULSING = new Set(["warning", "emergency"]);

// Warm red reused from halVisualizer.ts (ring stroke). One palette
// across the emotional-colour surfaces of the product.
const EMERGENCY_RED = "rgb(255, 120, 80)";
const EMERGENCY_GLOW = "rgba(255, 70, 30, 0.65)";


function useAlertAge(timestamp: number | null): string | null {
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
  useResetOnHardReload();
  const { lastAlert } = useHalAlerts();
  const age = useAlertAge(lastAlert?.timestamp ?? null);

  if (!lastAlert) return null;

  const isEmergency = lastAlert.severity === "emergency";
  const severityLabel =
    SEVERITY_LABEL[lastAlert.severity] ?? lastAlert.severity.toUpperCase();
  const classLabel = CLASS_LABEL[lastAlert.severity] ?? "";
  const threatName =
    THREAT_NAME[lastAlert.event_id] ?? THREAT_NAME[lastAlert.name];
  const isPulsing = PULSING.has(lastAlert.severity);
  const moduleLabel = lastAlert.module
    ? lastAlert.module.toUpperCase().replace(/_/g, " ")
    : null;

  // Class 1 emergencies get a warm-red border + glow + bullet. Every
  // other severity stays fully monochrome (hairline white/50 border,
  // white bullet) matching ExteriorHud.
  const cardStyle = isEmergency
    ? {
        borderColor: EMERGENCY_RED,
        borderWidth: "1px",
        boxShadow: `0 0 24px ${EMERGENCY_GLOW}, inset 0 0 12px ${EMERGENCY_GLOW}`,
      }
    : undefined;

  const bulletBg = isEmergency ? EMERGENCY_RED : "#ffffff";
  const bulletPingBg = isEmergency
    ? "rgba(255, 120, 80, 0.7)"
    : "rgba(255, 255, 255, 0.6)";

  return (
    // Positioned at the TOP of the viewport, clear of HAL's visualizer
    // at the bottom. Offset downward past PartCaption/InteriorCaption's
    // "Highlighting / Now At" title so the two stack cleanly when both
    // are visible. Max width keeps the banner from spanning too wide.
    <div className="fixed top-[5.25rem] left-1/2 -translate-x-1/2 z-30 pointer-events-none select-none">
      <div
        className={
          "bg-black/85 backdrop-blur-[2px] px-5 py-3 w-[min(640px,calc(100vw-2rem))] " +
          (isEmergency ? "" : "border-[0.5px] border-white/50")
        }
        style={cardStyle}
      >
        {/* Header row — class + severity + threat/module + age. */}
        <div className="flex items-center gap-3 font-mono uppercase tracking-[0.22em] text-[9px] text-white-dim">
          <span className="relative flex h-1.5 w-1.5 items-center justify-center">
            {isPulsing && (
              <span
                className="absolute inline-flex h-full w-full rounded-full animate-ping"
                style={{ backgroundColor: bulletPingBg, opacity: 0.8 }}
              />
            )}
            <span
              className="relative inline-flex h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: bulletBg }}
            />
          </span>
          {isEmergency ? (
            <span
              className="font-semibold tracking-[0.28em]"
              style={{ color: EMERGENCY_RED }}
            >
              PRIORITY
            </span>
          ) : (
            <span className="text-white">ALERT</span>
          )}
          <span className="text-white-faint">·</span>
          <span
            className={isEmergency ? "" : "text-white"}
            style={isEmergency ? { color: EMERGENCY_RED } : undefined}
          >
            {classLabel}
          </span>
          <span className="text-white-faint">·</span>
          <span className="text-white">{severityLabel}</span>
          {threatName && (
            <>
              <span className="text-white-faint">·</span>
              <span
                className="tracking-[0.2em]"
                style={{ color: isEmergency ? EMERGENCY_RED : undefined }}
              >
                {threatName}
              </span>
            </>
          )}
          {moduleLabel && !threatName && (
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

        {/* Module line on emergencies — since threat name took its
            slot in the header, surface the module separately so the
            affected section of the ship is still legible. */}
        {isEmergency && moduleLabel && (
          <div className="mt-1 font-mono uppercase tracking-[0.18em] text-[9px] text-white-dim">
            Module · <span className="text-white">{moduleLabel}</span>
          </div>
        )}

        {/* Primary line — what HAL actually said. */}
        <div
          className={
            "mt-2 font-serif leading-snug " +
            (isEmergency ? "text-[20px] text-white" : "text-[18px] text-white")
          }
        >
          {lastAlert.text}
        </div>

        {/* Tertiary — where the alert came from. */}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono uppercase tracking-[0.14em] text-[8px] text-white-faint">
          <span>SOURCE · {lastAlert.source}</span>
          <span>GATE · {lastAlert.gate}</span>
        </div>
      </div>
    </div>
  );
}
