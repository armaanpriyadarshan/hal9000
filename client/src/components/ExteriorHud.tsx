"use client";

import { useEffect, useState } from "react";
import { BracketFrame } from "./BracketFrame";

const MISSION_EPOCH = Date.parse("2024-09-15T08:00:00Z");

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

export default function ExteriorHud() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const missionDays = Math.floor((now - MISSION_EPOCH) / 86_400_000);
  const altKm = 408 + Math.sin(now / 20_000) * 2;
  const velKmS = 7.66 + Math.cos(now / 15_000) * 0.01;
  const pressureKpa = 101.3 + Math.sin(now / 8_000) * 0.3;
  const o2Pct = 20.9 + Math.cos(now / 9_000) * 0.05;
  const co2Ppm = 4000 + Math.sin(now / 5_000) * 100;

  return (
    <BracketFrame className="fixed top-hud-inset left-hud-inset px-4 py-3 w-[240px] z-20 pointer-events-none">
      <div className="font-serif text-3xl text-white leading-none mb-1">
        HAL 9000
      </div>
      <div className="font-mono uppercase tracking-[0.12em] text-[10px] text-white-dim mb-3">
        Heuristically Algorithmic
      </div>
      <div className="h-px w-full bg-white/15 mb-3" />
      <div className="flex flex-col gap-1">
        <HudRow label="EXPEDITION" value="73" />
        <HudRow label="MISSION DAY" value={String(missionDays).padStart(3, "0")} />
        <HudRow label="MET" value={formatMet(now)} />
        <HudRow label="CLOCK" value={`${formatClock(now)} UTC`} />
        <div className="h-px w-full bg-white/10 my-1" />
        <HudRow label="ORBITAL ALT." value={`${altKm.toFixed(1)} KM`} />
        <HudRow label="VELOCITY" value={`${velKmS.toFixed(3)} KM/S`} />
        <HudRow label="INCLINATION" value="51.64°" />
        <div className="h-px w-full bg-white/10 my-1" />
        <HudRow label="CABIN PRESS." value={`${pressureKpa.toFixed(1)} KPA`} />
        <HudRow label="O₂" value={`${o2Pct.toFixed(2)} %`} />
        <HudRow label="CO₂" value={`${co2Ppm.toFixed(0)} PPM`} />
      </div>
    </BracketFrame>
  );
}
