"use client";

import { useEffect, useRef, useState } from "react";
import {
  LightstreamerClient,
  Subscription,
  type ItemUpdate,
} from "lightstreamer-client-web";

import type { PuiId, PuiValue } from "@/lib/issLive";

export type LsState = "linking" | "connected" | "stalled" | "error";

const ENDPOINT = "https://push.lightstreamer.com";
const ADAPTER = "ISSLIVE";
const SCHEMA = ["TimeStamp", "Value", "Status.Class"] as const;

/**
 * Subscribe to a fixed set of ISS Live PUIs and expose their latest values
 * as React state. Safe to call inside a client component; the hook does
 * all work inside useEffect so SSR never touches the Lightstreamer client
 * (which is browser-only).
 *
 * The `puis` argument should be a stable reference (e.g. a module-level
 * readonly array); changing its identity triggers a full reconnect.
 */
export function useIssLightstreamer(puis: readonly PuiId[]): {
  values: Partial<Record<PuiId, PuiValue>>;
  state: LsState;
} {
  const [values, setValues] = useState<Partial<Record<PuiId, PuiValue>>>({});
  const [state, setState] = useState<LsState>("linking");
  const valuesRef = useRef(values);
  valuesRef.current = values;

  useEffect(() => {
    const client = new LightstreamerClient(ENDPOINT, ADAPTER);
    const subscription = new Subscription("MERGE", [...puis], [...SCHEMA]);
    subscription.setRequestedSnapshot("yes");

    const listener = {
      onItemUpdate: (update: ItemUpdate) => {
        const name = update.getItemName() as PuiId | null;
        if (!name) return;
        const value = update.getValue("Value") ?? "";
        const timestamp = update.getValue("TimeStamp") ?? "";
        const status = update.getValue("Status.Class");
        setValues((prev) => ({
          ...prev,
          [name]: {
            value,
            timestamp,
            status: status ?? null,
            receivedAt: performance.now(),
          },
        }));
      },
    };
    subscription.addListener(listener);

    const clientListener = {
      onStatusChange: (status: string) => {
        if (status.startsWith("CONNECTED")) setState("connected");
        else if (status.startsWith("CONNECTING") || status.startsWith("STREAM-SENSING"))
          setState("linking");
        else if (status.startsWith("STALLED")) setState("stalled");
        else if (status.startsWith("DISCONNECTED"))
          setState(valuesRef.current && Object.keys(valuesRef.current).length > 0 ? "error" : "error");
      },
      onServerError: () => setState("error"),
    };
    client.addListener(clientListener);

    try {
      client.subscribe(subscription);
      client.connect();
    } catch {
      setState("error");
    }

    return () => {
      try {
        client.unsubscribe(subscription);
      } catch {
        /* noop */
      }
      try {
        client.disconnect();
      } catch {
        /* noop */
      }
    };
    // puis is expected to be a stable reference (module-level const).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puis]);

  return { values, state };
}
