"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { base64ToArrayBuffer, defaultServerUrl } from "@/lib/halAudio";
import { executeClientDirectives } from "@/lib/halTools";

/**
 * SSE subscriber for HAL's proactive alert stream (Phase 2 ORA loop).
 *
 * When the server-side Observer flags an anomaly and the Reasoner
 * gate approves, the Actor broadcasts a payload via
 * `GET /api/alerts/stream`. This hook subscribes, plays the
 * TTS audio, optionally focuses the 3D scene on the offending
 * module, and exposes `lastAlert` for HUD rendering.
 *
 * Mount once per page. The native EventSource auto-reconnects on
 * transient errors with its built-in backoff, so we do not retry
 * manually.
 */

export type HalAlertSeverity =
  | "advisory"
  | "caution"
  | "warning"
  | "emergency";

export type HalAlert = {
  event_id: string;
  name: string;
  severity: HalAlertSeverity;
  module: string | null;
  text: string;
  audio_b64: string;
  source: string; // "anomaly" | "threshold" | "operator"
  timestamp: number;
  gate: string; // "canned" | "llm" | "operator"
};

export type UseHalAlertsOptions = {
  enabled?: boolean;
  /** Invoked once per alert received (after audio playback starts). */
  onAlert?: (alert: HalAlert) => void;
  /**
   * If true (default), an alert's `module` field drives a
   * navigate_to / highlight_part directive so the scene follows the
   * anomaly. Disable when the demo team wants HAL to speak without
   * steering the camera.
   */
  autoFocus?: boolean;
};

// Kept in sync with client/src/lib/interiorAreas.ts; duplicated here
// as a plain list to avoid an import cycle with next/navigation.
const INTERIOR_MODULES = new Set([
  "pmm",
  "unity",
  "harmony",
  "tranquility",
  "cupola",
  "destiny",
  "columbus",
  "kibo_jpm",
  "kibo_jlp",
  "airlock",
]);

export function useHalAlerts(opts: UseHalAlertsOptions = {}) {
  const { enabled = true, autoFocus = true } = opts;
  const onAlertRef = useRef(opts.onAlert);
  // Stash the callback in a ref so changing it doesn't tear down the
  // EventSource every render.
  useEffect(() => {
    onAlertRef.current = opts.onAlert;
  }, [opts.onAlert]);

  const [lastAlert, setLastAlert] = useState<HalAlert | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return; // SSR guard

    const url = `${defaultServerUrl()}/api/alerts/stream`;
    const es = new EventSource(url);

    es.onmessage = async (ev) => {
      let alert: HalAlert;
      try {
        alert = JSON.parse(ev.data) as HalAlert;
      } catch (err) {
        console.warn("[useHalAlerts] malformed SSE payload", err);
        return;
      }

      setLastAlert(alert);

      // Kick audio first so the crew hears HAL even if the scene
      // auto-focus below throws. Audio is detached from the scene.
      if (alert.audio_b64) {
        try {
          if (!audioCtxRef.current) {
            audioCtxRef.current = new AudioContext();
          }
          const ctx = audioCtxRef.current;
          // Browsers suspend AudioContext until a user gesture. If the
          // page hasn't been clicked yet, resume() will succeed once
          // the user has pressed Space to talk at least once; before
          // then, the first alert will fail to play. That's acceptable
          // for the demo — the crew is expected to have interacted.
          if (ctx.state === "suspended") {
            try {
              await ctx.resume();
            } catch {
              /* no-op */
            }
          }
          const buf = base64ToArrayBuffer(alert.audio_b64);
          const decoded = await ctx.decodeAudioData(buf.slice(0));
          const src = ctx.createBufferSource();
          src.buffer = decoded;
          src.connect(ctx.destination);
          src.start();
        } catch (err) {
          console.warn("[useHalAlerts] audio play failed", err);
        }
      }

      // Scene auto-focus — route the alert's module to the existing
      // client directive dispatcher so we get camera motion + highlight
      // for free.
      if (autoFocus && alert.module) {
        const isInterior = INTERIOR_MODULES.has(alert.module);
        const directive = isInterior
          ? {
              name: "navigate_to",
              arguments: { area: alert.module },
            }
          : {
              name: "highlight_part",
              arguments: { part: alert.module },
            };
        try {
          executeClientDirectives([directive], { router });
        } catch (err) {
          console.warn("[useHalAlerts] scene focus failed", err);
        }
      }

      onAlertRef.current?.(alert);
    };

    es.onerror = (err) => {
      // EventSource retries automatically with its own backoff. We
      // log once per transition so the console doesn't spam on a
      // flaky network.
      console.warn("[useHalAlerts] EventSource error", err);
    };

    return () => {
      es.close();
      const ctx = audioCtxRef.current;
      // Don't close the AudioContext — future page mounts will reuse
      // it via the ref reset on next mount. Just detach.
      audioCtxRef.current = null;
      void ctx; // keep the linter happy; GC will finalise it.
    };
    // Intentionally no `onAlert` in deps — callback is via ref.
  }, [enabled, autoFocus, router]);

  return { lastAlert };
}
