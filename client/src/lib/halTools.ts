"use client";

import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

export type ClientToolCtx = {
  router: AppRouterInstance;
};

export type ClientDirective = {
  name: string;
  arguments: Record<string, unknown>;
};

type Handler = (args: Record<string, unknown>, ctx: ClientToolCtx) => void;

// Severities the scene knows how to tint against. Must match the
// AlertSeverity enum on the server; anything else gets treated as
// "none" and the default blue Fresnel renders.
const RISK_VALUES = new Set(["advisory", "caution", "warning", "emergency"]);

function riskParam(args: Record<string, unknown>): string {
  const raw = typeof args.risk === "string" ? args.risk : "";
  return RISK_VALUES.has(raw) ? `&risk=${encodeURIComponent(raw)}` : "";
}

const CLIENT_TOOLS: Record<string, Handler> = {
  set_view: (args, { router }) => {
    const view = typeof args.view === "string" ? args.view : "";
    if (view === "exterior") router.push("/exterior");
    else if (view === "interior") router.push("/");
  },
  highlight_part: (args, { router }) => {
    const part = typeof args.part === "string" ? args.part : "";
    if (!part) return;
    // Append a nonce so repeat calls with the same part still change the
    // URL and retrigger the scene's highlight effect (camera lerp + label).
    // Optional `risk` carries severity from proactive alerts so the
    // scene can tint the highlight (see ISSExteriorScene).
    router.push(
      `/exterior?highlight=${encodeURIComponent(part)}${riskParam(args)}&t=${Date.now().toString(36)}`,
    );
  },
  navigate_to: (args, { router }) => {
    const area = typeof args.area === "string" ? args.area : "";
    if (!area) return;
    // Nonce mirrors highlight_part — repeat navigations to the same
    // area retrigger the scene's flight effect.
    router.push(
      `/?area=${encodeURIComponent(area)}${riskParam(args)}&t=${Date.now().toString(36)}`,
    );
  },
};

export function executeClientDirectives(
  directives: ClientDirective[],
  ctx: ClientToolCtx,
): void {
  for (const directive of directives) {
    const handler = CLIENT_TOOLS[directive.name];
    if (!handler) {
      console.warn(`[halTools] unknown client tool: ${directive.name}`);
      continue;
    }
    try {
      handler(directive.arguments ?? {}, ctx);
    } catch (err) {
      console.warn(`[halTools] handler for ${directive.name} threw:`, err);
    }
  }
}
