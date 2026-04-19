"use client";

import { useEffect, useRef } from "react";

import { useHalAlerts, type HalAlert } from "@/hooks/useHalAlerts";

/**
 * Full-screen warm-red vignette pulse triggered when a Class 1
 * emergency alert fires. Driven by the Web Animations API rather
 * than CSS keyframes — CSS `animation` with the same rule name
 * occasionally fails to restart on React remount; WAAPI always
 * fires the full sequence when `.animate()` is called.
 *
 * GPU-composited, pointer-events-none, warm palette (matches
 * halVisualizer so the scene's one emotional colour source stays
 * consistent).
 */

const FLASH_DURATION_MS = 1800;

const PULSE_KEYFRAMES: Keyframe[] = [
  { opacity: 0, offset: 0 },
  { opacity: 0.55, offset: 0.1 },
  { opacity: 0, offset: 0.25 },
  { opacity: 0.5, offset: 0.35 },
  { opacity: 0, offset: 0.5 },
  { opacity: 0.42, offset: 0.6 },
  { opacity: 0, offset: 0.75 },
  { opacity: 0, offset: 1 },
];


export default function EmergencyFlash() {
  const { lastAlert } = useHalAlerts();
  const signature = emergencySignature(lastAlert);
  const divRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!signature || !divRef.current) return;
    const anim = divRef.current.animate(PULSE_KEYFRAMES, {
      duration: FLASH_DURATION_MS,
      easing: "cubic-bezier(0.4, 0, 0.6, 1)",
      fill: "forwards",
    });
    return () => {
      try {
        anim.cancel();
      } catch {
        /* no-op */
      }
    };
  }, [signature]);

  // Render the overlay div permanently — the WAAPI animation controls
  // opacity. Starts at 0 so nothing shows until an emergency fires.
  return (
    <div
      ref={divRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-20"
      style={{
        background:
          "radial-gradient(ellipse at center, rgba(0,0,0,0) 35%, rgba(255,70,30,0.55) 78%, rgba(255,40,10,0.85) 100%)",
        opacity: 0,
        willChange: "opacity",
      }}
    />
  );
}


function emergencySignature(alert: HalAlert | null): string | null {
  if (!alert) return null;
  if (alert.severity !== "emergency") return null;
  return `${alert.event_id}:${alert.timestamp}`;
}
