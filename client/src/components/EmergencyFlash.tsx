"use client";

import { useHalAlerts, type HalAlert } from "@/hooks/useHalAlerts";

/**
 * Full-screen warm-red vignette pulse triggered when a Class 1
 * emergency alert fires. CSS-only animation — no JS per-frame work,
 * no setState-in-effect, no AudioContext. GPU-composited so it does
 * not impact the 3D scene's frame rate.
 *
 * Implementation note: we use React's `key` prop tied to the alert
 * signature (event_id + timestamp) to remount the animated div on
 * every new emergency. That restarts the CSS keyframes from 0% without
 * any JavaScript timer bookkeeping. Once the animation finishes it
 * holds at 0% opacity (invisible), so the div is effectively dormant
 * until a new emergency re-mounts it.
 *
 * Colour palette matches halVisualizer (warm orange/red) — the one
 * emotional-colour exception to the monochrome HUD rule.
 */

const FLASH_DURATION_MS = 1800;


export default function EmergencyFlash() {
  const { lastAlert } = useHalAlerts();
  const signature = emergencySignature(lastAlert);

  if (!signature) return null;

  return (
    <>
      {/* Keyframes live inline so the component is self-contained.
          Three pulses in FLASH_DURATION_MS; rests at 0% thereafter. */}
      <style>{`
        @keyframes hal-emergency-pulse {
          0%, 100% { opacity: 0; }
          10%      { opacity: 0.55; }
          25%      { opacity: 0; }
          35%      { opacity: 0.5; }
          50%      { opacity: 0; }
          60%      { opacity: 0.42; }
          75%      { opacity: 0; }
        }
      `}</style>
      <div
        key={signature}
        aria-hidden
        className="pointer-events-none fixed inset-0 z-20"
        style={{
          // Radial gradient anchored at screen edges — clear center so
          // the 3D scene remains readable even at peak flash.
          background:
            "radial-gradient(ellipse at center, rgba(0,0,0,0) 35%, rgba(255,70,30,0.55) 78%, rgba(255,40,10,0.85) 100%)",
          animation: `hal-emergency-pulse ${FLASH_DURATION_MS}ms cubic-bezier(0.4, 0, 0.6, 1) 1 both`,
          willChange: "opacity",
        }}
      />
    </>
  );
}


/** Key for the flash effect. Returns null when the latest alert is
 *  not an emergency — we only trigger the vignette on Class 1. */
function emergencySignature(alert: HalAlert | null): string | null {
  if (!alert) return null;
  if (alert.severity !== "emergency") return null;
  return `${alert.event_id}:${alert.timestamp}`;
}
