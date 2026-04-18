"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { HudRow } from "./hud/HudRow";
import { BarRow } from "./hud/BarRow";
import { RadialGauge } from "./hud/RadialGauge";
import { Sparkline } from "./hud/Sparkline";
import { LineChart, type ChartSeries } from "./hud/LineChart";
import { AttitudeIndicator } from "./hud/AttitudeIndicator";
import { useIssLightstreamer, type LsState } from "@/hooks/useIssLightstreamer";
import {
  SUBSCRIBED_PUIS,
  readPui,
  formatPuiValue,
  type PuiId,
  type PuiValue,
} from "@/lib/issLive";

const MISSION_EPOCH = Date.parse("2026-02-26T12:00:00Z");
const SPARKLINE_WINDOW = 60;

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

// ----- helpers ----------------------------------------------------------

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

function lsLabel(state: LsState, haveAny: boolean): string {
  if (state === "connected" && haveAny) return "LIVE";
  if (state === "connected") return "LINKING";
  if (state === "stalled") return "STALE";
  if (state === "error") return "OFFLINE";
  return "LINKING";
}

function StatusDot({ state, haveAny }: { state: LsState; haveAny: boolean }) {
  const label = lsLabel(state, haveAny);
  const dim = label !== "LIVE";
  return (
    <span
      className={`font-mono uppercase tracking-[0.12em] text-[9px] ${
        dim ? "text-white-faint" : "text-white"
      }`}
    >
      ● {label}
    </span>
  );
}

function SectionHead({
  title,
  right,
}: {
  title: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between mb-2">
      <span className="font-mono uppercase tracking-[0.22em] text-[9px] text-white-dim">
        {title}
      </span>
      {right}
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
    <div className="mt-4 flex items-center gap-2 font-mono uppercase tracking-[0.2em] text-[9px] text-white-dim">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-60 animate-ping" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
      </span>
      <span className="text-white">HAL 9000</span>
      <span>Monitoring</span>
      <span className="ml-2 tabular-nums text-white-faint">
        {pad(h)}:{pad(m)}:{pad(s)}
      </span>
    </div>
  );
}

// ----- main -------------------------------------------------------------

export default function ExteriorHud() {
  const [now, setNow] = useState(() => Date.now());
  const [mountedAt] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const { values: lsValues, state: lsState } = useIssLightstreamer(SUBSCRIBED_PUIS);
  const haveAny = Object.keys(lsValues).length > 0;

  const cabinKpa = readPui(lsValues, "USLAB000058");
  const cabinC = readPui(lsValues, "USLAB000059");
  const ppO2 = readPui(lsValues, "USLAB000053");
  const ppCo2 = readPui(lsValues, "USLAB000055");
  const cmg = readPui(lsValues, "USLAB000010");
  const roll = readPui(lsValues, "USLAB000022");
  const pitch = readPui(lsValues, "USLAB000023");
  const yaw = readPui(lsValues, "USLAB000024");
  const solarBeta = readPui(lsValues, "USLAB000040");
  const sarj = readPui(lsValues, "S0000003");
  const array1ACurr = readPui(lsValues, "S4000002");
  const array2AVolt = readPui(lsValues, "P4000001");
  const nodeO2 = readPui(lsValues, "NODE3000001");
  const nodeCo2 = readPui(lsValues, "NODE3000003");
  const o2Gen = readPui(lsValues, "NODE3000010");
  const wasteH2O = readPui(lsValues, "NODE3000008");
  const potableH2O = readPui(lsValues, "NODE3000009");

  const cabinTempHistory = useSparklineHistory(lsValues, "USLAB000059");
  const ppCo2History = useSparklineHistory(lsValues, "USLAB000055");
  const ppO2History = useSparklineHistory(lsValues, "USLAB000053");
  const cabinPressHistory = useSparklineHistory(lsValues, "USLAB000058");
  const nodeCo2History = useSparklineHistory(lsValues, "NODE3000003");
  const array1History = useSparklineHistory(lsValues, "S4000002");
  const array2History = useSparklineHistory(lsValues, "P4000001");
  const cmgHistory = useSparklineHistory(lsValues, "USLAB000010");

  // Total attitude error magnitude (sqrt of sum of squares).
  const attitudeError =
    roll !== null && pitch !== null && yaw !== null
      ? Math.sqrt(roll * roll + pitch * pitch + yaw * yaw)
      : null;

  // Lab vs Node 3 ppCO₂ — same units + similar range, per-series
  // normalisation in LineChart still makes both visible even when
  // they drift by different magnitudes.
  const co2Series: ChartSeries[] = [
    { label: "lab", values: ppCo2History },
    { label: "node 3", values: nodeCo2History, dashed: true },
  ];
  // Power trend — 1A drive current vs 2A drive voltage, independent
  // per-series normalisation shows each shape.
  const powerSeries: ChartSeries[] = [
    { label: "1A CURR", values: array1History },
    { label: "2A VOLT", values: array2History, dashed: true },
  ];

  return (
    <>
      {/* ===== TOP-LEFT ===== hero + HAL brand */}
      <div className="fixed top-hud-inset left-hud-inset z-20 pointer-events-none select-none">
        <div className="font-serif text-[88px] text-white leading-[0.9] tracking-tight">
          ISS
        </div>
        <div className="font-mono uppercase tracking-[0.28em] text-[10px] text-white mt-2">
          International Space Station
        </div>
        <div className="font-mono uppercase tracking-[0.22em] text-[9px] text-white-dim mt-1">
          Expedition 78 · Crew 3
        </div>
        <HalPill mountedAt={mountedAt} />
        <div className="mt-8 flex flex-col gap-0.5 font-mono uppercase tracking-[0.16em] text-[9px] text-white-faint leading-snug max-w-[240px]">
          <span>H.A.L. 9000 · Urbana IL</span>
          <span>Activation 1992.01.12</span>
          <span>Heuristically programmed algorithmic computer</span>
        </div>
      </div>

      {/* ===== TOP-RIGHT ===== life support (ECLSS) */}
      <div className="fixed top-hud-inset right-hud-inset z-20 pointer-events-none select-none w-[300px]">
        <SectionHead
          title="Life Support · ECLSS"
          right={<StatusDot state={lsState} haveAny={haveAny} />}
        />

        {/* hero: ppCO2 — serif for variation */}
        <div className="flex items-baseline justify-end gap-2">
          <span className="font-mono uppercase tracking-[0.18em] text-[9px] text-white-dim">
            ppCO₂
          </span>
          <span className="font-serif text-[44px] text-white tabular-nums leading-none">
            {ppCo2 !== null ? ppCo2.toFixed(0) : "——"}
          </span>
          <span className="font-mono uppercase tracking-[0.12em] text-[10px] text-white-dim">
            ppm
          </span>
        </div>
        <div className="mt-1 text-right font-mono uppercase tracking-[0.16em] text-[9px] text-white-faint">
          Lab partial pressure · CO₂ scrub threshold 5300 ppm
        </div>

        {/* Lab vs Node 3 ppCO₂ comparison */}
        <div className="mt-3 flex justify-end">
          <LineChart series={co2Series} width={300} height={60} />
        </div>
        <div className="mt-1 flex justify-between font-mono uppercase tracking-[0.16em] text-[8px] text-white-faint">
          <span>— Lab ppCO₂</span>
          <span>-- Node 3 ppCO₂</span>
        </div>

        {/* primary ECLSS rows */}
        <div className="mt-4 flex flex-col gap-1.5">
          <BarRow
            label="Lab ppO₂"
            value={formatPuiValue("USLAB000053", ppO2)}
            pct={ppO2 !== null ? (ppO2 - 18) / (23 - 18) : 0}
          />
          <BarRow
            label="Node 3 ppO₂"
            value={formatPuiValue("NODE3000001", nodeO2)}
            pct={nodeO2 !== null ? (nodeO2 - 18) / (23 - 18) : 0}
          />
          <HudRow
            label="Cabin Press."
            value={formatPuiValue("USLAB000058", cabinKpa)}
          />
          <div>
            <div className="flex items-baseline gap-3">
              <span className="font-mono uppercase tracking-[0.12em] text-[10px] text-white-dim">
                Cabin Temp
              </span>
              <span className="font-mono uppercase tracking-[0.08em] text-xs text-white tabular-nums ml-auto">
                {formatPuiValue("USLAB000059", cabinC)}
              </span>
            </div>
            <Sparkline values={cabinTempHistory} width={300} height={16} showMarker />
          </div>
        </div>

        {/* water + O2 gen */}
        <div className="mt-3 pt-3 border-t border-white/10 flex flex-col gap-1.5">
          <BarRow
            label="Waste H₂O"
            value={formatPuiValue("NODE3000008", wasteH2O)}
            pct={wasteH2O !== null ? wasteH2O / 100 : 0}
          />
          <BarRow
            label="Potable H₂O"
            value={formatPuiValue("NODE3000009", potableH2O)}
            pct={potableH2O !== null ? potableH2O / 100 : 0}
          />
          <HudRow
            label="O₂ Gen."
            value={
              o2Gen !== null
                ? o2Gen > 0
                  ? `ACTIVE ${o2Gen.toFixed(0)}`
                  : "STANDBY"
                : "——"
            }
          />
        </div>
      </div>

      {/* ===== BOTTOM-LEFT ===== attitude (ADCS) */}
      <div className="fixed bottom-hud-inset left-hud-inset z-20 pointer-events-none select-none w-[260px]">
        <SectionHead
          title="Attitude · ADCS"
          right={<StatusDot state={lsState} haveAny={haveAny} />}
        />
        <div className="flex items-start gap-4">
          <AttitudeIndicator
            roll={roll ?? 0}
            pitch={pitch ?? 0}
            yaw={yaw ?? 0}
            size={96}
          />
          <div className="flex flex-col flex-1 gap-2">
            {/* serif hero: total attitude error magnitude */}
            <div>
              <div className="font-mono uppercase tracking-[0.18em] text-[9px] text-white-dim">
                Error Mag.
              </div>
              <div className="font-serif text-[28px] text-white tabular-nums leading-none">
                {attitudeError !== null ? attitudeError.toFixed(2) : "——"}
                <span className="font-mono text-[10px] text-white-dim ml-1">°</span>
              </div>
            </div>
            <div className="font-mono uppercase tracking-[0.14em] text-[9px] text-white-faint leading-tight">
              <div className="flex justify-between">
                <span>ROLL</span>
                <span className="text-white tabular-nums">
                  {roll !== null ? roll.toFixed(2) : "——"}
                </span>
              </div>
              <div className="flex justify-between">
                <span>PITCH</span>
                <span className="text-white tabular-nums">
                  {pitch !== null ? pitch.toFixed(2) : "——"}
                </span>
              </div>
              <div className="flex justify-between">
                <span>YAW</span>
                <span className="text-white tabular-nums">
                  {yaw !== null ? yaw.toFixed(2) : "——"}
                </span>
              </div>
            </div>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <RadialGauge
            size={44}
            pct={cmg !== null ? cmg / 100 : undefined}
            label="CMG Momentum"
            value={formatPuiValue("USLAB000010", cmg)}
          />
          <div className="flex-1">
            <Sparkline values={cmgHistory} width={140} height={20} showMarker grid />
          </div>
        </div>
        <div className="mt-3 pt-2 border-t border-white/10">
          <HudRow
            label="Solar β"
            value={formatPuiValue("USLAB000040", solarBeta)}
          />
        </div>
      </div>

      {/* ===== BOTTOM-RIGHT ===== mission time + power */}
      <div className="fixed bottom-hud-inset right-hud-inset z-20 pointer-events-none select-none w-[300px] text-right">
        <SectionHead
          title="Mission · Power · EPS"
          right={<StatusDot state={lsState} haveAny={haveAny} />}
        />

        {/* serif hero clock */}
        <div className="font-serif text-[48px] text-white tabular-nums leading-[0.9]">
          {formatClock(now)}
        </div>
        <div className="mt-1 font-mono uppercase tracking-[0.22em] text-[9px] text-white-dim">
          GMT · MET {formatMet(now)}
        </div>

        {/* power trend chart */}
        <div className="mt-5 flex justify-end">
          <LineChart series={powerSeries} width={300} height={44} />
        </div>
        <div className="mt-1 flex justify-between font-mono uppercase tracking-[0.16em] text-[8px] text-white-faint">
          <span>— 1A current</span>
          <span>-- 2A voltage</span>
        </div>

        {/* power rows with individual sparklines */}
        <div className="mt-3 flex flex-col gap-2">
          <div>
            <div className="flex items-baseline gap-3">
              <span className="font-mono uppercase tracking-[0.12em] text-[10px] text-white-dim">
                Array 1A Curr.
              </span>
              <span className="font-mono uppercase tracking-[0.08em] text-xs text-white tabular-nums ml-auto">
                {formatPuiValue("S4000002", array1ACurr)}
              </span>
            </div>
            <Sparkline values={array1History} width={300} height={14} showMarker />
          </div>
          <div>
            <div className="flex items-baseline gap-3">
              <span className="font-mono uppercase tracking-[0.12em] text-[10px] text-white-dim">
                Array 2A Volt.
              </span>
              <span className="font-mono uppercase tracking-[0.08em] text-xs text-white tabular-nums ml-auto">
                {formatPuiValue("P4000001", array2AVolt)}
              </span>
            </div>
            <Sparkline values={array2History} width={300} height={14} showMarker />
          </div>
        </div>

        {/* SARJ radial dial */}
        <div className="mt-4 flex justify-end">
          <RadialGauge
            size={56}
            angle={sarj ?? undefined}
            label="SARJ Stbd"
            value={formatPuiValue("S0000003", sarj)}
          />
        </div>
      </div>
    </>
  );
}
