"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { defaultServerUrl } from "@/lib/halAudio";
import { executeClientDirectives } from "@/lib/halTools";


/**
 * Global event bus so a proactive alert can route its audio through
 * HalVoice's AudioContext + analyser — the one the visualizer is
 * already wired to. Without this, alert audio played on a separate
 * context and HAL's eye stayed idle while it "spoke".
 *
 * HalVoice listens on `window.addEventListener(HAL_ALERT_EVENT, ...)`.
 */
export const HAL_ALERT_EVENT = "hal-alert-audio";

export type HalAlertAudioEvent = CustomEvent<{
  audio_b64: string;
  text: string;
  event_id: string;
}>;

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
  /**
   * If true, don't play the alert's base64 WAV locally. Used by the
   * operator /ops panel so HAL's voice isn't duplicated across the
   * audience browser and the operator's backstage browser.
   */
  mute?: boolean;
  /** Bounded alert history size; default 50. */
  historyLimit?: number;
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
  const {
    enabled = true,
    // Default off per the 2026-04-19 test session. Auto-navigating
    // pages when an alert fires caused a mount race — the fire-page's
    // HalAlertHud + EmergencyFlash unmounted before they could render
    // the alert, and the destination page's fresh useHalAlerts had
    // no lastAlert state. The UX is also better: HAL announces in
    // place, then asks the crew if they'd like to see the affected
    // region, and emits navigate_to / highlight_part in response to
    // a voice "yes". Callers who want the old behaviour can still
    // opt in explicitly.
    autoFocus = false,
    mute = false,
    historyLimit = 50,
  } = opts;
  const onAlertRef = useRef(opts.onAlert);
  // Stash the callback in a ref so changing it doesn't tear down the
  // EventSource every render.
  useEffect(() => {
    onAlertRef.current = opts.onAlert;
  }, [opts.onAlert]);

  const [lastAlert, setLastAlert] = useState<HalAlert | null>(null);
  const [alertHistory, setAlertHistory] = useState<HalAlert[]>([]);
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
      setAlertHistory((prev) => {
        const next = [alert, ...prev];
        return next.length > historyLimit ? next.slice(0, historyLimit) : next;
      });

      // Delegate playback to HalVoice via a CustomEvent. HalVoice owns
      // the singleton AudioContext + analyser that drives halVisualizer
      // — routing alert audio through it means HAL's eye animates while
      // speaking a proactive alert, identical to a Q&A reply. Also
      // prevents two AudioContexts from contending.
      if (!mute && alert.audio_b64) {
        try {
          window.dispatchEvent(
            new CustomEvent(HAL_ALERT_EVENT, {
              detail: {
                audio_b64: alert.audio_b64,
                text: alert.text,
                event_id: alert.event_id,
              },
            }),
          );
        } catch (err) {
          console.warn("[useHalAlerts] alert audio dispatch failed", err);
        }
      }

      // Scene auto-focus — route the alert's module to the existing
      // client directive dispatcher. The severity travels along as
      // `risk` so the scene can colour the highlight accordingly
      // (blue default → warm-red for warning/emergency).
      if (autoFocus && alert.module) {
        const isInterior = INTERIOR_MODULES.has(alert.module);
        const directive = isInterior
          ? {
              name: "navigate_to",
              arguments: { area: alert.module, risk: alert.severity },
            }
          : {
              name: "highlight_part",
              arguments: { part: alert.module, risk: alert.severity },
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
    };
    // Intentionally no `onAlert` in deps — callback is via ref.
  }, [enabled, autoFocus, mute, historyLimit, router]);

  return { lastAlert, alertHistory };
}
