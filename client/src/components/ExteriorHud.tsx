"use client";

import { useEffect, useState, type ReactNode } from "react";

// Mission epoch anchors MET; not used for any derived real telemetry.
const MISSION_EPOCH = Date.parse("2026-02-26T12:00:00Z");
// ISS orbital inclination — NORAD catalog 25544 keeps this near-constant.
const INCLINATION_DEG = 51.64;
// ISS orbital period (92.68 min). Only used for the static PERIOD readout.
const ORBIT_PERIOD_MIN = 92.68;
// wheretheiss.at poll interval. Their rate limit is ~1/sec; 5 s keeps us
// comfortably under and avoids hammering a free API for a decorative HUD.
const ISS_POLL_MS = 5000;

type IssLive = {
  latitude: number;
  longitude: number;
  altitude: number;
  velocity: number;
  visibility: "daylight" | "eclipsed";
  fetchedAt: number;
};

function useIssLive(): { data: IssLive | null; stale: boolean } {
  const [data, setData] = useState<IssLive | null>(null);
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
          visibility:
            json.visibility === "eclipsed" ? "eclipsed" : "daylight",
          fetchedAt: Date.now(),
        });
      } catch {
        // Network hiccup; keep last value. Don't spam the console — one
        // failure is noise, the retry will usually succeed.
      }
    };

    fetchOnce();
    const id = setInterval(fetchOnce, ISS_POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
      clearInterval(tick);
    };
  }, []);

  const stale = data ? now - data.fetchedAt > ISS_POLL_MS * 3 : true;
  return { data, stale };
}

function HudRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3 leading-tight">
      <span className="font-mono uppercase tracking-[0.12em] text-[10px] text-white-dim">
        {label}
      </span>
      <span className="font-mono uppercase tracking-[0.08em] text-xs text-white tabular-nums ml-auto">
        {value}
      </span>
    </div>
  );
}

function BarRow({
  label,
  value,
  pct,
}: {
  label: string;
  value: string;
  pct: number;
}) {
  const clamped = Math.max(0, Math.min(1, pct));
  return (
    <div>
      <div className="flex items-baseline gap-3 leading-tight">
        <span className="font-mono uppercase tracking-[0.12em] text-[10px] text-white-dim">
          {label}
        </span>
        <span className="font-mono uppercase tracking-[0.08em] text-xs text-white tabular-nums ml-auto">
          {value}
        </span>
      </div>
      <div className="h-[2px] w-full bg-white/10 mt-1">
        <div
          className="h-full bg-white"
          style={{ width: `${(clamped * 100).toFixed(1)}%` }}
        />
      </div>
    </div>
  );
}

function GroupLabel({
  title,
  source,
}: {
  title: string;
  source?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between mt-3 mb-1.5 first:mt-0">
      <span className="font-mono uppercase tracking-[0.18em] text-[9px] text-white-dim">
        {title}
      </span>
      {source ? (
        <span className="font-mono uppercase tracking-[0.12em] text-[9px] text-white-faint">
          {source}
        </span>
      ) : null}
    </div>
  );
}

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

export default function ExteriorHud() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const { data, stale } = useIssLive();
  const liveStatus = !data ? "LINKING" : stale ? "STALE" : "LIVE";

  // Real values from wheretheiss.at (velocity is km/h → convert to km/s).
  const altKm = data?.altitude;
  const velKmS = data ? data.velocity / 3600 : undefined;
  const lat = data?.latitude;
  const lon = data?.longitude;
  const illuminated = data?.visibility === "daylight";

  // Simulated ECLSS — no free public endpoint. Tagged SIM in the header.
  const pressureKpa = 101.3 + Math.sin(now / 8_000) * 0.2;
  const o2Pct = 20.9 + Math.cos(now / 9_000) * 0.06;
  const co2Ppm = 2800 + Math.sin(now / 5_000) * 500;
  const humidityPct = 48 + Math.sin(now / 11_000) * 4;
  const cabinTempC = 22.5 + Math.cos(now / 17_000) * 0.6;

  // Simulated EPS — tracks illumination when we know it.
  const sunFactor = data ? (illuminated ? 1 : 0) : 0.6;
  const arrayKw =
    sunFactor * 88 + Math.sin(now / 3_000) * 1.5 * sunFactor;
  const batterySoc = data
    ? illuminated
      ? 0.85 + Math.sin(now / 40_000) * 0.1
      : 0.62 + Math.sin(now / 40_000) * 0.08
    : 0.78;
  const loadKw = 72 + Math.cos(now / 7_000) * 2.5;

  return (
    <div className="fixed top-hud-inset left-hud-inset w-[280px] z-20 pointer-events-none select-none">
      <div className="font-serif text-[28px] text-white leading-[1.0]">
        International
        <br />
        Space Station
      </div>
      <div className="font-mono uppercase tracking-[0.2em] text-[10px] text-white-dim mt-1.5">
        Expedition 78 · Crew 3
      </div>

      <div className="h-px w-full bg-white/15 my-3" />

      <GroupLabel title="Mission Time" />
      <div className="flex flex-col gap-1">
        <HudRow label="GMT" value={`${formatClock(now)} UTC`} />
        <HudRow label="MET" value={formatMet(now)} />
      </div>

      <GroupLabel
        title="Orbit"
        source={
          <span
            className={
              liveStatus === "LIVE"
                ? "text-white"
                : liveStatus === "LINKING"
                  ? "text-white-dim"
                  : "text-white-faint"
            }
          >
            ● {liveStatus}
          </span>
        }
      />
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
          value={data ? (illuminated ? "ILLUMINATED" : "ECLIPSE") : "——"}
        />
      </div>

      <GroupLabel title="ECLSS" source="SIM" />
      <div className="flex flex-col gap-1.5">
        <HudRow label="CABIN PRESS." value={`${pressureKpa.toFixed(2)} KPA`} />
        <BarRow
          label="O₂"
          value={`${o2Pct.toFixed(2)} %`}
          pct={(o2Pct - 19.5) / (22 - 19.5)}
        />
        <BarRow
          label="CO₂"
          value={`${co2Ppm.toFixed(0)} PPM`}
          pct={co2Ppm / 5300}
        />
        <BarRow
          label="HUMIDITY"
          value={`${humidityPct.toFixed(0)} %`}
          pct={humidityPct / 100}
        />
        <HudRow label="CABIN TEMP" value={`${cabinTempC.toFixed(1)} °C`} />
      </div>

      <GroupLabel title="EPS" source="SIM" />
      <div className="flex flex-col gap-1.5">
        <BarRow
          label="ARRAY PWR"
          value={`${arrayKw.toFixed(1)} KW`}
          pct={arrayKw / 120}
        />
        <BarRow
          label="BATTERY"
          value={`${(batterySoc * 100).toFixed(0)} %`}
          pct={batterySoc}
        />
        <HudRow label="LOAD" value={`${loadKw.toFixed(1)} KW`} />
      </div>
    </div>
  );
}
