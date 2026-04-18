"use client";

import { useEffect, useState, type ReactNode } from "react";

// Mission epoch chosen so the MET counter reads ~60 days at current time.
const MISSION_EPOCH = Date.parse("2026-02-26T12:00:00Z");
// ISS orbital period: 92.68 minutes = 5560.8 seconds.
const ORBIT_PERIOD_S = 5560.8;
// Real ISS inclination.
const INCLINATION_DEG = 51.64;

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

function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono uppercase tracking-[0.18em] text-[9px] text-white-faint mb-1.5 mt-3 first:mt-0">
      {children}
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

function formatLatLon(v: number, pos: string, neg: string): string {
  const sign = v < 0 ? neg : pos;
  return `${Math.abs(v).toFixed(2)}° ${sign}`;
}

export default function ExteriorHud() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsedMs = Math.max(0, now - MISSION_EPOCH);
  const orbitCount = Math.floor(elapsedMs / 1000 / ORBIT_PERIOD_S);
  const orbitPhase = ((now / 1000) % ORBIT_PERIOD_S) / ORBIT_PERIOD_S;

  // Orbital — typical post-reboost altitude drifts within ~418-420 km.
  const altKm = 418.5 + Math.sin(now / 30_000) * 1.2;
  const velKmS = 7.663 + Math.cos(now / 45_000) * 0.006;
  // Ground track: lat oscillates within ±inclination; lon advances with the
  // orbit and Earth rotation (fake but plausible).
  const lat = INCLINATION_DEG * Math.sin(orbitPhase * Math.PI * 2);
  const lonBase = ((now / 600_000) * 360) % 360;
  const lon = lonBase > 180 ? lonBase - 360 : lonBase;

  // Sun exposure over the orbit (roughly ~60% illuminated, ~40% eclipse).
  const sunElevation = Math.sin(orbitPhase * Math.PI * 2);
  const illuminated = sunElevation > -0.15;

  // ECLSS — Environmental Control & Life Support.
  const pressureKpa = 101.3 + Math.sin(now / 8_000) * 0.2;
  const o2Pct = 20.9 + Math.cos(now / 9_000) * 0.06;
  const co2Ppm = 2800 + Math.sin(now / 5_000) * 500;
  const humidityPct = 48 + Math.sin(now / 11_000) * 4;
  const cabinTempC = 22.5 + Math.cos(now / 17_000) * 0.6;

  // EPS — Electrical Power System. Array power tracks sunlight; battery
  // discharges during eclipse and recharges under illumination.
  const arrayKw = illuminated
    ? Math.max(0, 88 * Math.max(0, sunElevation)) + Math.sin(now / 3_000) * 1.5
    : 0;
  const batterySoc =
    0.78 + 0.18 * Math.sin(orbitPhase * Math.PI * 2 + Math.PI / 3);
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

      <GroupLabel>Mission Time</GroupLabel>
      <div className="flex flex-col gap-1">
        <HudRow label="GMT" value={`${formatClock(now)} UTC`} />
        <HudRow label="MET" value={formatMet(now)} />
        <HudRow label="ORBIT N°" value={String(orbitCount).padStart(4, "0")} />
      </div>

      <GroupLabel>Orbit</GroupLabel>
      <div className="flex flex-col gap-1.5">
        <BarRow
          label="ALTITUDE"
          value={`${altKm.toFixed(2)} KM`}
          pct={(altKm - 408) / (420 - 408)}
        />
        <HudRow label="VELOCITY" value={`${velKmS.toFixed(3)} KM/S`} />
        <HudRow label="INCLINATION" value={`${INCLINATION_DEG.toFixed(2)}°`} />
        <HudRow label="PERIOD" value="92.68 MIN" />
        <BarRow
          label="ORBIT PHASE"
          value={`${(orbitPhase * 100).toFixed(0)} %`}
          pct={orbitPhase}
        />
        <HudRow label="LAT" value={formatLatLon(lat, "N", "S")} />
        <HudRow label="LON" value={formatLatLon(lon, "E", "W")} />
        <HudRow label="SUN" value={illuminated ? "ILLUMINATED" : "ECLIPSE"} />
      </div>

      <GroupLabel>ECLSS</GroupLabel>
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

      <GroupLabel>EPS</GroupLabel>
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
