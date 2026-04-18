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
    router.push(`/exterior?highlight=${encodeURIComponent(part)}`);
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
