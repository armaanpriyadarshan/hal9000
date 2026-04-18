"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { HudRow } from "./hud/HudRow";
import { BarRow } from "./hud/BarRow";
import { RadialGauge } from "./hud/RadialGauge";
import { Sparkline } from "./hud/Sparkline";
import { AttitudeIndicator } from "./hud/AttitudeIndicator";
import { useIssLightstreamer, type LsState } from "@/hooks/useIssLightstreamer";
import {
  SUBSCRIBED_PUIS,
  readPui,
  formatPuiValue,
  type PuiId,
  type PuiValue,
} from "@/lib/issLive";

// Mission epoch anchors MET.
const MISSION_EPOCH = Date.parse("2026-02-26T12:00:00Z");
const INCLINATION_DEG = 51.64;
const ORBIT_PERIOD_MIN = 92.68;
const WHERE_THE_ISS_POLL_MS = 5000;
const SPARKLINE_WINDOW = 60;

// ----- wheretheiss.at live orbital position (altitude/velocity/lat/lon) ---

type IssPos = {
  latitude: number;
  longitude: number;
  altitude: number;
  velocity: number;
  visibility: "daylight" | "eclipsed";
  fetchedAt: number;
};

function useIssPosition(): { data: IssPos | null; stale: boolean } {
  const [data, setData] = useState<IssPos | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const fetchOnce = async () => {
      try {
        const res = await fetch(
          "https://api.wheretheiss.at/v1/satellites/25544",
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        setData({
          latitude: json.latitude,
          longitude: json.longitude,
          altitude: json.altitude,
          velocity: json.velocity,
          visibility: json.visibility === "eclipsed" ? "eclipsed" : "daylight",
          fetchedAt: Date.now(),
        });
      } catch {
        /* keep last */
      }
    };
    fetchOnce();
    const id = setInterval(fetchOnce, WHERE_THE_ISS_POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
      clearInterval(tick);
    };
  }, []);

  const stale = data ? now - data.fetchedAt > WHERE_THE_ISS_POLL_MS * 3 : true;
  return { data, stale };
}

// ----- rolling sparkline history per PUI --------------------------------

function useSparklineHistory(
  values: Partial<Record<PuiId, PuiValue>>,
  puiId: PuiId,
): number[] {
  const [history, setHistory] = useState<number[]>([]);
  const lastStamp = useRef<string | null>(null);

  useEffect(() => {
    const entry = values[puiId];
    if (!entry) return;
    if (entry.timestamp === lastStamp.current) return;
    lastStamp.current = entry.timestamp;
    const parsed = readPui(values, puiId);
    if (parsed === null) return;
    setHistory((prev) => {
      const next = [...prev, parsed];
      return next.length > SPARKLINE_WINDOW
        ? next.slice(next.length - SPARKLINE_WINDOW)
        : next;
    });
  }, [values, puiId]);

  return history;
}

// ----- small helpers ----------------------------------------------------

function formatClock(now: number): string {
  return new Date(now).toISOString().slice(11, 19);
}

function formatMet(now: number): string {
  const elapsed = Math.max(0, now - MISSION_EPOCH);
  const days = Math.floor(elapsed / 86_400_000);
  const rem = elapsed % 86_400_000;
  const h = Math.floor(rem / 3_600_000);
  const m = Math.floor((rem % 3_600_000) / 60_000);
  const s = Math.floor((rem % 60_000) / 1_000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(days, 3)}/${pad(h)}:${pad(m)}:${pad(s)}`;
}

function formatLatLon(v: number | undefined, pos: string, neg: string): string {
  if (v === undefined) return "——";
  const sign = v < 0 ? neg : pos;
  return `${Math.abs(v).toFixed(2)}° ${sign}`;
}

function lsStatusLabel(state: LsState, haveAny: boolean): string {
  if (state === "connected" && haveAny) return "LIVE";
  if (state === "connected") return "LINKING";
  if (state === "stalled") return "STALE";
  if (state === "error") return "OFFLINE";
  return "LINKING";
}

// ----- section header with status pill ----------------------------------

function SectionHeader({
  title,
  status,
  source,
}: {
  title: string;
  status: string;
  source?: ReactNode;
}) {
  const dimmed = status !== "LIVE";
  return (
    <div className="flex items-baseline justify-between mt-3 mb-1.5 first:mt-0">
      <span className="font-mono uppercase tracking-[0.18em] text-[9px] text-white-dim">
        {title}
      </span>
      <span className="flex items-baseline gap-2 font-mono uppercase tracking-[0.12em] text-[9px]">
        {source ? <span className="text-white-faint">{source}</span> : null}
        <span className={dimmed ? "text-white-faint" : "text-white"}>
          ● {status}
        </span>
      </span>
    </div>
  );
}

// ----- HAL fictional elements -------------------------------------------

function HalPill({ mountedAt }: { mountedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const uptimeSec = Math.floor((now - mountedAt) / 1000);
  const h = Math.floor(uptimeSec / 3600);
  const m = Math.floor((uptimeSec % 3600) / 60);
  const s = uptimeSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <div className="mt-2 mb-1 flex items-center gap-2 font-mono uppercase tracking-[0.18em] text-[9px] text-white-dim">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-60 animate-ping" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
      </span>
      <span className="text-white">HAL 9000</span>
      <span>· Monitoring</span>
      <span className="ml-auto tabular-nums">
        {pad(h)}:{pad(m)}:{pad(s)}
      </span>
    </div>
  );
}

function HalFooter() {
  return (
    <div className="mt-4 flex flex-col gap-0.5 font-mono uppercase tracking-[0.14em] text-[9px] text-white-faint leading-snug">
      <span>H.A.L. 9000 · Urbana IL · Activation 1992.01.12</span>
      <span>Heuristically programmed algorithmic computer</span>
      <span>Session active · Link nominal</span>
    </div>
  );
}

// ----- main component ---------------------------------------------------

export default function ExteriorHud() {
  const [now, setNow] = useState(() => Date.now());
  const [mountedAt] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const { values: lsValues, state: lsState } = useIssLightstreamer(SUBSCRIBED_PUIS);
  const { data: iss, stale: issStale } = useIssPosition();

  const haveAnyLs = Object.keys(lsValues).length > 0;
  const lsStatus = lsStatusLabel(lsState, haveAnyLs);
  const issStatus = !iss ? "LINKING" : issStale ? "STALE" : "LIVE";

  // Parse PUIs of interest.
  const cabinKpa = readPui(lsValues, "USLAB000058");
  const cabinC = readPui(lsValues, "USLAB000059");
  const ppO2 = readPui(lsValues, "USLAB000053");
  const ppCo2 = readPui(lsValues, "USLAB000055");
  const wasteH2O = readPui(lsValues, "NODE3000008");
  const potableH2O = readPui(lsValues, "NODE3000009");
  const array1ACurr = readPui(lsValues, "S4000002");
  const array2AVolt = readPui(lsValues, "P4000001");
  const sarj = readPui(lsValues, "S0000003");
  const cmg = readPui(lsValues, "USLAB000010");
  const roll = readPui(lsValues, "USLAB000022");
  const pitch = readPui(lsValues, "USLAB000023");
  const yaw = readPui(lsValues, "USLAB000024");
  const solarBeta = readPui(lsValues, "USLAB000040");

  const cabinTempHistory = useSparklineHistory(lsValues, "USLAB000059");
  const ppCo2History = useSparklineHistory(lsValues, "USLAB000055");

  // Orbit position from wheretheiss.at.
  const altKm = iss?.altitude;
  const velKmS = iss ? iss.velocity / 3600 : undefined;
  const lat = iss?.latitude;
  const lon = iss?.longitude;
  const illuminated = iss?.visibility === "daylight";

  return (
    <div className="fixed top-hud-inset left-hud-inset w-[300px] z-20 pointer-events-none select-none">
      <div className="font-serif text-[28px] text-white leading-[1.0]">
        International
        <br />
        Space Station
      </div>
      <div className="font-mono uppercase tracking-[0.2em] text-[10px] text-white-dim mt-1.5">
        Expedition 78 · Crew 3
      </div>

      <HalPill mountedAt={mountedAt} />

      <div className="h-px w-full bg-white/15 my-3" />

      <SectionHeader title="Mission Time" status="LIVE" />
      <div className="flex flex-col gap-1">
        <HudRow label="GMT" value={`${formatClock(now)} UTC`} />
        <HudRow label="MET" value={formatMet(now)} />
      </div>

      <SectionHeader title="Orbit" source="wheretheiss.at" status={issStatus} />
      <div className="flex flex-col gap-1.5">
        <BarRow
          label="ALTITUDE"
          value={altKm !== undefined ? `${altKm.toFixed(2)} KM` : "—— KM"}
          pct={altKm !== undefined ? (altKm - 408) / (422 - 408) : 0}
        />
        <HudRow
          label="VELOCITY"
          value={velKmS !== undefined ? `${velKmS.toFixed(3)} KM/S` : "—— KM/S"}
        />
        <HudRow label="INCLINATION" value={`${INCLINATION_DEG.toFixed(2)}°`} />
        <HudRow label="PERIOD" value={`${ORBIT_PERIOD_MIN.toFixed(2)} MIN`} />
        <HudRow label="LAT" value={formatLatLon(lat, "N", "S")} />
        <HudRow label="LON" value={formatLatLon(lon, "E", "W")} />
        <HudRow
          label="SUN"
          value={iss ? (illuminated ? "ILLUMINATED" : "ECLIPSE") : "——"}
        />
      </div>

      <SectionHeader title="ADCS" source="NASA ISSLIVE" status={lsStatus} />
      <div className="flex items-start gap-3 mb-1.5">
        <AttitudeIndicator
          roll={roll ?? 0}
          pitch={pitch ?? 0}
          yaw={yaw ?? 0}
          size={56}
        />
        <div className="flex flex-col gap-1 flex-1">
          <HudRow label="ROLL" value={formatPuiValue("USLAB000022", roll)} />
          <HudRow label="PITCH" value={formatPuiValue("USLAB000023", pitch)} />
          <HudRow label="YAW" value={formatPuiValue("USLAB000024", yaw)} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <RadialGauge
          size={40}
          pct={cmg !== null ? cmg / 100 : undefined}
          label="CMG MOMENTUM"
          value={formatPuiValue("USLAB000010", cmg)}
        />
        <HudRow
          label="SOLAR BETA"
          value={formatPuiValue("USLAB000040", solarBeta)}
        />
      </div>

      <SectionHeader title="ECLSS" source="NASA ISSLIVE" status={lsStatus} />
      <div className="flex flex-col gap-1.5">
        <HudRow
          label="CABIN PRESS."
          value={formatPuiValue("USLAB000058", cabinKpa)}
        />
        <div>
          <div className="flex items-baseline gap-3 leading-tight">
            <span className="font-mono uppercase tracking-[0.12em] text-[10px] text-white-dim">
              CABIN TEMP
            </span>
            <span className="font-mono uppercase tracking-[0.08em] text-xs text-white tabular-nums ml-auto">
              {formatPuiValue("USLAB000059", cabinC)}
            </span>
          </div>
          <Sparkline values={cabinTempHistory} width={280} height={14} />
        </div>
        <BarRow
          label="ppO₂"
          value={formatPuiValue("USLAB000053", ppO2)}
          pct={ppO2 !== null ? (ppO2 - 18) / (23 - 18) : 0}
        />
        <div>
          <div className="flex items-baseline gap-3 leading-tight">
            <span className="font-mono uppercase tracking-[0.12em] text-[10px] text-white-dim">
              ppCO₂
            </span>
            <span className="font-mono uppercase tracking-[0.08em] text-xs text-white tabular-nums ml-auto">
              {formatPuiValue("USLAB000055", ppCo2)}
            </span>
          </div>
          <div className="h-[2px] w-full bg-white/10 mt-1">
            <div
              className="h-full bg-white"
              style={{
                width: `${Math.max(0, Math.min(100, ((ppCo2 ?? 0) / 5300) * 100)).toFixed(1)}%`,
              }}
            />
          </div>
          <div className="mt-1">
            <Sparkline values={ppCo2History} width={280} height={14} />
          </div>
        </div>
        <BarRow
          label="WASTE H₂O"
          value={formatPuiValue("NODE3000008", wasteH2O)}
          pct={wasteH2O !== null ? wasteH2O / 100 : 0}
        />
        <BarRow
          label="POTABLE H₂O"
          value={formatPuiValue("NODE3000009", potableH2O)}
          pct={potableH2O !== null ? potableH2O / 100 : 0}
        />
      </div>

      <SectionHeader title="EPS" source="NASA ISSLIVE" status={lsStatus} />
      <div className="flex flex-col gap-1.5">
        <HudRow
          label="ARRAY 1A CURR."
          value={formatPuiValue("S4000002", array1ACurr)}
        />
        <HudRow
          label="ARRAY 2A VOLT."
          value={formatPuiValue("P4000001", array2AVolt)}
        />
        <RadialGauge
          size={40}
          angle={sarj ?? undefined}
          label="SARJ STBD"
          value={formatPuiValue("S0000003", sarj)}
        />
      </div>

      <HalFooter />
    </div>
  );
}
