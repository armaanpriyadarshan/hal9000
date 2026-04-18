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
    // The scene reads only `highlight`, ignoring `t`.
    router.push(
      `/exterior?highlight=${encodeURIComponent(part)}&t=${Date.now().toString(36)}`,
    );
  },
  navigate_to: (args, { router }) => {
    const area = typeof args.area === "string" ? args.area : "";
    if (!area) return;
    // Nonce mirrors highlight_part — repeat navigations to the same
    // area retrigger the scene's flight effect.
    router.push(
      `/?area=${encodeURIComponent(area)}&t=${Date.now().toString(36)}`,
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
