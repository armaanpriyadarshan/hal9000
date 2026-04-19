"use client";

import { useEffect, useRef, useState } from "react";

import { defaultServerUrl } from "@/lib/halAudio";
import { useHalAlerts } from "@/hooks/useHalAlerts";

/**
 * Backstage operator console. Not linked from the demo UI — open at
 * /ops in a second browser window/laptop. Drives the demo mid-stage
 * (inject anomalies, force alerts, pause/enable the Reasoner) while
 * the main /, /exterior views stay clean for the audience.
 *
 * Style mirrors ExteriorHud exactly — mono uppercase labels with
 * aggressive tracking, serif hero numbers, monochrome palette,
 * hairline borders, no shadow/blur/rounding. Intentionally ugly —
 * this is a control panel, not a product page.
 *
 * The SSE subscription runs muted (audio lives on the audience
 * browser) and with autoFocus off (we don't want the ops console
 * hijacking scene navigation on every alert).
 */

// Canonical anomaly catalog — mirrors server/anomalies.py ANOMALIES.
// If these drift from the server list, the buttons still work (the
// server validates by name) but the displayed severity/module will
// be stale. Keep in sync with server/anomalies.py.
const ANOMALY_BUTTONS = [
  { name: "slow_o2_leak",           severity: "caution",   module: "main_modules", label: "Slow O2 Leak" },
  { name: "cdra_regen_fail",        severity: "caution",   module: "tranquility",  label: "CDRA Regen Fail" },
  { name: "ammonia_loop_leak",      severity: "warning",   module: "s0_truss",     label: "NH3 Loop Leak" },
  { name: "sarj_bearing_drift",     severity: "advisory",  module: "s0_truss",     label: "SARJ Bearing" },
  { name: "cmg_saturation",         severity: "caution",   module: null,           label: "CMG Saturation" },
  { name: "iatcs_mtl_pump_fail",    severity: "warning",   module: "destiny",      label: "IATCS Pump" },
  { name: "sabatier_catalyst_cool", severity: "advisory",  module: "tranquility",  label: "Sabatier Cool" },
] as const;

// Quick-fire canned alerts per severity — lets the operator exercise
// the full Actor path (TTS → SSE → audience audio + scene focus)
// without triggering a real state change. Each fires with
// use_llm_gate=false so there's no 2-3 s gate round-trip.
const QUICK_ALERTS = [
  { severity: "advisory",  text: "Commander, flagging an advisory status for review." },
  { severity: "caution",   text: "Commander, I am flagging a caution. Recommend checking the relevant panel." },
  { severity: "warning",   text: "Commander, warning. Your attention is required." },
  { severity: "emergency", text: "PRIORITY ALERT. Immediate crew action required." },
] as const;


// Class 1 emergency scenarios matching the ISS C&W vocabulary (fire /
// rapid depress / toxic atmosphere + O2 depletion). `name` must match
// THREAT_NAME lookup in HalAlertHud so the banner renders the canonical
// ISS threat label. Canned text follows the published emergency-response
// procedure in server/corpus/emergencies-*.md so what HAL says on stage
// matches what an actual ISS crew would hear.
// Every Class-1 canned line ends with an offer that names the
// specific tool target (exterior part or interior module), so when
// the crew says "yes" HAL has the enum value in its conversation
// history and can emit the matching highlight_part / navigate_to
// tool call. Scene doesn't auto-focus anymore — see useHalAlerts.
const CLASS_1_SCENARIOS = [
  {
    name: "rapid_depress",
    module: "main_modules",
    label: "Rapid Depress",
    subtext: "Hull breach / rapid cabin P drop",
    text: (
      "PRIORITY ALERT. Cabin pressure is dropping rapidly. " +
      "Commander, close all hatches immediately and don emergency " +
      "oxygen. We may have a hull breach. " +
      "Would you like me to highlight the main modules on the " +
      "exterior view?"
    ),
  },
  {
    name: "po2_critical",
    module: "main_modules",
    label: "O2 Depletion",
    subtext: "pO2 critically low",
    text: (
      "EMERGENCY. Cabin oxygen is critically low. Commander, don " +
      "oxygen masks now. I am compensating via ACS high-pressure " +
      "tank makeup. " +
      "Would you like me to highlight the main modules on the " +
      "exterior view?"
    ),
  },
  {
    name: "cabin_fire",
    module: "destiny",
    label: "Fire · Destiny",
    subtext: "Smoke detector trip",
    text: (
      "EMERGENCY. Smoke detector trip in Destiny. Commander, shut off " +
      "ventilation in the affected segment and prepare portable fire " +
      "extinguishers. I am isolating the Destiny IMV. " +
      "Would you like me to navigate to Destiny?"
    ),
  },
  {
    name: "toxic_atmosphere_nh3",
    module: "destiny",
    label: "Tox Atm · NH3",
    subtext: "Ammonia detected in cabin",
    text: (
      "EMERGENCY. Ammonia detected in the cabin atmosphere. Commander, " +
      "don emergency breathing apparatus and proceed to the Russian " +
      "segment safe haven. I am isolating the affected IFHX. " +
      "Would you like me to navigate to Destiny?"
    ),
  },
] as const;


type ChatTurn = {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  source?: string;
};


type ShipStateJson = {
  p_total_kpa: number;
  pp_o2_kpa: number;
  pp_co2_kpa: number;
  pp_n2_kpa: number;
  cabin_t_c: number;
  cabin_rh_pct: number;
  oga_o2_rate_kg_day: number;
  cdra_removal_kg_day: number;
  loop_a_nh3_t_c: number;
  loop_b_nh3_t_c: number;
  ata_a_pressure_mpa: number;
  array_current_a: number;
  battery_soc_pct: number;
  sarj_motor_current_a: number;
  cmg_momentum_frac: number;
  orbit_phase: string;
  orbit_t_in_phase_s: number;
  t_sim_s: number;
  crew_count: number;
  active_anomalies: string[];
};


export default function OpsConsole() {
  const serverRef = useRef(defaultServerUrl());
  const server = serverRef.current;

  // Muted + non-navigating subscription — operator only wants the
  // alert history, not the audio (audience browser plays) or scene
  // hijack (operator isn't viewing the scene).
  const { alertHistory } = useHalAlerts({
    autoFocus: false,
    mute: true,
    historyLimit: 50,
  });

  const [ship, setShip] = useState<ShipStateJson | null>(null);
  const [alertsEnabled, setAlertsEnabled] = useState(true);
  const [serverUp, setServerUp] = useState(true);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Text-chat workspace — drives /api/text so operators can verify
  // telemetry awareness + RAG procedure-retrieval without needing
  // the audience browser's mic or any curl command.
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);

  // Poll telemetry every 2 s. Faster than the 1 Hz sim isn't useful
  // (we'd just see the same sample twice); slower makes the operator
  // feel out of sync during demo.
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = await fetch(`${server}/api/debug/telemetry`);
        if (!r.ok) {
          if (!cancelled) setServerUp(false);
          return;
        }
        const data = (await r.json()) as ShipStateJson;
        if (!cancelled) {
          setShip(data);
          setServerUp(true);
        }
      } catch {
        if (!cancelled) setServerUp(false);
      }
    }
    tick();
    const id = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [server]);

  async function post(path: string, body?: object): Promise<Record<string, unknown> | null> {
    setBusy(true);
    try {
      const r = await fetch(`${server}${path}`, {
        method: "POST",
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!r.ok) {
        setLastAction(`${path} → ${r.status} ${r.statusText}`);
        return null;
      }
      const data = await r.json().catch(() => null);
      setLastAction(`${path} → ok`);
      return data;
    } catch (err) {
      setLastAction(`${path} → ${(err as Error).message}`);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function sendChat() {
    const text = chatInput.trim();
    if (!text || chatBusy) return;
    setChatBusy(true);
    const userTurn: ChatTurn = {
      role: "user",
      text,
      timestamp: Date.now() / 1000,
    };
    setChatTurns((prev) => [...prev, userTurn]);
    setChatInput("");
    try {
      const r = await fetch(`${server}/api/text`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!r.ok) {
        setChatTurns((prev) => [
          ...prev,
          {
            role: "assistant",
            text: `[error: ${r.status} ${r.statusText}]`,
            timestamp: Date.now() / 1000,
          },
        ]);
        return;
      }
      const data = (await r.json()) as {
        reply?: string;
        source?: string;
      };
      setChatTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          text: data.reply ?? "",
          timestamp: Date.now() / 1000,
          source: data.source,
        },
      ]);
    } catch (err) {
      setChatTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          text: `[error: ${(err as Error).message}]`,
          timestamp: Date.now() / 1000,
        },
      ]);
    } finally {
      setChatBusy(false);
    }
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-black text-white flex flex-col">
      {/* Page header */}
      <header className="flex items-end justify-between border-b border-white/10 px-6 pt-6 pb-4">
        <div>
          <div className="font-mono uppercase tracking-[0.26em] text-[10px] text-white-dim">
            HAL 9000 · Operator Console
          </div>
          <h1 className="mt-1 font-serif text-[40px] leading-none">OPS</h1>
        </div>
        <div className="flex flex-col items-end gap-1 font-mono uppercase tracking-[0.18em] text-[9px]">
          <div className="text-white-dim">
            Server · <span className="text-white">{server.replace(/^https?:\/\//, "")}</span>
          </div>
          <div className="flex items-center gap-2 text-white-dim">
            <span className="relative flex h-1.5 w-1.5">
              <span
                className={`absolute inline-flex h-full w-full rounded-full ${
                  serverUp ? "bg-white opacity-60 animate-ping" : ""
                }`}
              />
              <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
                serverUp ? "bg-white" : "bg-white-faint"
              }`} />
            </span>
            <span className={serverUp ? "text-white" : "text-white-faint"}>
              {serverUp ? "LINKED" : "OFFLINE"}
            </span>
          </div>
          <div className="text-white-dim">
            Alerts · <span className={alertsEnabled ? "text-white" : "text-white-faint"}>
              {alertsEnabled ? "ENABLED" : "PAUSED"}
            </span>
          </div>
        </div>
      </header>

      {/* Three-column workspace */}
      <main className="grid grid-cols-3 gap-4 flex-1 min-h-0 p-6">
        {/* Column 1: controls */}
        <div className="flex flex-col gap-5 overflow-auto pr-2">
          <Section title="Class 1 Emergency · Canned, No Gate">
            <div className="grid grid-cols-2 gap-2">
              {CLASS_1_SCENARIOS.map((s) => (
                <button
                  key={s.name}
                  disabled={busy}
                  onClick={() =>
                    post("/api/debug/fire_alert", {
                      name: s.name,
                      severity: "emergency",
                      module: s.module,
                      text: s.text,
                    })
                  }
                  className={
                    "text-left bg-black px-3 py-2 " +
                    "border border-[rgb(255,120,80)] " +
                    "transition-colors hover:bg-[rgba(255,120,80,0.08)] " +
                    "active:bg-[rgba(255,120,80,0.16)] " +
                    "disabled:opacity-40 disabled:cursor-not-allowed"
                  }
                  style={{
                    boxShadow: "0 0 10px rgba(255, 70, 30, 0.35)",
                  }}
                >
                  <div
                    className="font-mono uppercase tracking-[0.18em] text-[8px]"
                    style={{ color: "rgb(255, 120, 80)" }}
                  >
                    CLASS 1
                  </div>
                  <div className="font-mono uppercase tracking-[0.12em] text-[10px] text-white leading-snug">
                    {s.label}
                  </div>
                  <div className="mt-0.5 font-mono uppercase tracking-[0.12em] text-[8px] text-white-faint">
                    {s.subtext}
                  </div>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Inject Anomaly">
            <div className="grid grid-cols-2 gap-2">
              {ANOMALY_BUTTONS.map((a) => (
                <OpButton
                  key={a.name}
                  disabled={busy}
                  onClick={() =>
                    post("/api/debug/inject", { anomaly: a.name })
                  }
                >
                  <div className="font-mono uppercase tracking-[0.14em] text-[8px] text-white-dim">
                    {a.severity}
                  </div>
                  <div className="font-mono uppercase tracking-[0.12em] text-[10px] text-white leading-snug">
                    {a.label}
                  </div>
                  <div className="mt-0.5 font-mono uppercase tracking-[0.12em] text-[8px] text-white-faint">
                    {a.module ? a.module.replace(/_/g, " ") : "no module"}
                  </div>
                </OpButton>
              ))}
            </div>
            <OpButton
              className="mt-3 w-full"
              disabled={busy}
              onClick={() => post("/api/debug/clear")}
            >
              <div className="font-mono uppercase tracking-[0.18em] text-[10px] text-white text-center">
                Clear All Anomalies
              </div>
            </OpButton>
          </Section>

          <Section title="Quick Alert · Canned, No Gate">
            <div className="flex flex-col gap-2">
              {QUICK_ALERTS.map((q) => (
                <OpButton
                  key={q.severity}
                  disabled={busy}
                  onClick={() =>
                    post("/api/debug/fire_alert", {
                      name: `ops_${q.severity}`,
                      severity: q.severity,
                      text: q.text,
                    })
                  }
                >
                  <div className="font-mono uppercase tracking-[0.14em] text-[8px] text-white-dim">
                    {q.severity}
                  </div>
                  <div className="mt-0.5 font-serif text-[13px] leading-snug text-white line-clamp-2">
                    {q.text}
                  </div>
                </OpButton>
              ))}
            </div>
          </Section>

          <Section title="Alert Control">
            <div className="grid grid-cols-3 gap-2">
              <OpButton
                disabled={busy}
                onClick={async () => {
                  const r = await post("/api/debug/alerts/pause");
                  if (r) setAlertsEnabled(false);
                }}
              >
                <div className="font-mono uppercase tracking-[0.14em] text-[9px] text-white text-center">
                  Pause
                </div>
              </OpButton>
              <OpButton
                disabled={busy}
                onClick={async () => {
                  const r = await post("/api/debug/alerts/enable");
                  if (r) setAlertsEnabled(true);
                }}
              >
                <div className="font-mono uppercase tracking-[0.14em] text-[9px] text-white text-center">
                  Enable
                </div>
              </OpButton>
              <OpButton
                disabled={busy}
                onClick={() => post("/api/debug/alerts/reset_cooldowns")}
              >
                <div className="font-mono uppercase tracking-[0.14em] text-[9px] text-white text-center">
                  Reset CD
                </div>
              </OpButton>
            </div>
            {lastAction && (
              <div className="mt-3 font-mono uppercase tracking-[0.14em] text-[8px] text-white-faint">
                Last · {lastAction}
              </div>
            )}
          </Section>
        </div>

        {/* Column 2: live telemetry + text chat */}
        <div className="flex flex-col gap-5 overflow-hidden pr-2">
          <Section title="Live Telemetry">
            {!ship ? (
              <div className="font-mono uppercase tracking-[0.14em] text-[9px] text-white-faint">
                Awaiting sim…
              </div>
            ) : (
              <TelemetryTable ship={ship} />
            )}
          </Section>

          <Section title="Text Chat · /api/text">
            <div className="flex flex-col gap-2 min-h-0">
              <div className="flex flex-col gap-2 overflow-auto max-h-[28vh]">
                {chatTurns.length === 0 ? (
                  <div className="font-mono uppercase tracking-[0.14em] text-[9px] text-white-faint">
                    Ask HAL something. Use to verify telemetry
                    awareness and emergency-procedure retrieval.
                  </div>
                ) : (
                  chatTurns.map((t, i) => (
                    <div
                      key={`${t.timestamp}-${i}`}
                      className="border-[0.5px] border-white/20 px-3 py-2"
                    >
                      <div className="font-mono uppercase tracking-[0.18em] text-[8px] text-white-dim">
                        {t.role === "user" ? "OPERATOR" : "HAL"}
                        {t.source && (
                          <span className="ml-2 text-white-faint">
                            · {t.source.toUpperCase()}
                          </span>
                        )}
                      </div>
                      <div
                        className={
                          t.role === "user"
                            ? "mt-1 font-mono text-[11px] text-white-dim"
                            : "mt-1 font-serif text-[13px] text-white leading-snug"
                        }
                      >
                        {t.text}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendChat();
                }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  disabled={chatBusy}
                  placeholder="Ask HAL (text)"
                  className={
                    "flex-1 bg-black border-[0.5px] border-white/50 px-3 py-2 " +
                    "font-mono text-[11px] text-white placeholder:text-white-faint " +
                    "focus:outline-none focus:border-white " +
                    "disabled:opacity-50"
                  }
                />
                <button
                  type="submit"
                  disabled={chatBusy || chatInput.trim().length === 0}
                  className={
                    "border-[0.5px] border-white/50 bg-black px-4 py-2 " +
                    "font-mono uppercase tracking-[0.18em] text-[10px] text-white " +
                    "transition-colors hover:bg-white/5 " +
                    "disabled:opacity-40 disabled:cursor-not-allowed"
                  }
                >
                  {chatBusy ? "…" : "Send"}
                </button>
              </form>
              {chatTurns.length > 0 && (
                <button
                  onClick={() => setChatTurns([])}
                  className="self-end font-mono uppercase tracking-[0.14em] text-[8px] text-white-faint hover:text-white-dim"
                >
                  clear log
                </button>
              )}
            </div>
          </Section>
        </div>

        {/* Column 3: alert log */}
        <div className="flex flex-col gap-5 overflow-hidden pr-2">
          <Section title={`Alert Log · ${alertHistory.length}`}>
            <div className="flex flex-col gap-2 overflow-auto">
              {alertHistory.length === 0 ? (
                <div className="font-mono uppercase tracking-[0.14em] text-[9px] text-white-faint">
                  No alerts yet.
                </div>
              ) : (
                alertHistory.map((a, i) => (
                  <div
                    key={`${a.event_id}-${i}`}
                    className="border-[0.5px] border-white/30 bg-black px-3 py-2"
                  >
                    <div className="flex items-baseline gap-2 font-mono uppercase tracking-[0.14em] text-[8px] text-white-dim">
                      <span className="text-white">{a.severity.toUpperCase()}</span>
                      <span className="text-white-faint">·</span>
                      <span>{a.source}</span>
                      {a.module && (
                        <>
                          <span className="text-white-faint">·</span>
                          <span>{a.module.replace(/_/g, " ")}</span>
                        </>
                      )}
                      <span className="ml-auto text-white-faint">{a.gate}</span>
                    </div>
                    <div className="mt-1 font-serif text-[13px] leading-snug text-white">
                      {a.text}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Section>
        </div>
      </main>
    </div>
  );
}


// ---- small building blocks ----------------------------------------


function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 border-b border-white/10 pb-2 font-mono uppercase tracking-[0.22em] text-[9px] text-white-dim">
        {title}
      </div>
      {children}
    </section>
  );
}


function OpButton({
  onClick,
  disabled,
  className = "",
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={
        "text-left border-[0.5px] border-white/50 bg-black px-3 py-2 " +
        "transition-colors hover:bg-white/5 active:bg-white/10 " +
        "disabled:opacity-40 disabled:cursor-not-allowed " +
        className
      }
    >
      {children}
    </button>
  );
}


function TelemetryTable({ ship }: { ship: ShipStateJson }) {
  // Rows mirror the ShipState block HAL sees in the system prompt.
  // Keep the labels short — the operator's reading this at a glance
  // during a live demo, not composing a report.
  const rows = [
    { k: "Cabin Total P",  v: `${ship.p_total_kpa.toFixed(2)} kPa`,          nom: "101.30" },
    { k: "pO2",            v: `${ship.pp_o2_kpa.toFixed(2)} kPa`,            nom: "21.30" },
    { k: "pCO2",           v: `${ship.pp_co2_kpa.toFixed(3)} kPa`,           nom: "0.400" },
    { k: "pN2",            v: `${ship.pp_n2_kpa.toFixed(2)} kPa`,            nom: "79.60" },
    { k: "Cabin T",        v: `${ship.cabin_t_c.toFixed(1)} °C`,             nom: "22.5" },
    { k: "RH",             v: `${ship.cabin_rh_pct.toFixed(0)} %`,           nom: "50" },
    { k: "OGA Rate",       v: `${ship.oga_o2_rate_kg_day.toFixed(2)} kg/d`,  nom: "5.40" },
    { k: "CDRA Rate",      v: `${ship.cdra_removal_kg_day.toFixed(2)} kg/d`, nom: "6.00" },
    { k: "Loop A T",       v: `${ship.loop_a_nh3_t_c.toFixed(1)} °C`,        nom: "2.8" },
    { k: "Loop B T",       v: `${ship.loop_b_nh3_t_c.toFixed(1)} °C`,        nom: "2.8" },
    { k: "ATA A P",        v: `${ship.ata_a_pressure_mpa.toFixed(2)} MPa`,   nom: "2.62" },
    { k: "Array Current",  v: `${ship.array_current_a.toFixed(0)} A`,        nom: "200 | 0" },
    { k: "Battery SoC",    v: `${ship.battery_soc_pct.toFixed(0)} %`,        nom: "—" },
    { k: "SARJ Current",   v: `${ship.sarj_motor_current_a.toFixed(2)} A`,   nom: "0.15" },
    { k: "CMG Momentum",   v: `${(ship.cmg_momentum_frac * 100).toFixed(0)} %`, nom: "—" },
  ];

  return (
    <div className="flex flex-col">
      <div className="flex items-baseline justify-between border-b border-white/10 pb-1 font-mono uppercase tracking-[0.14em] text-[8px] text-white-faint">
        <span>Channel</span>
        <span className="flex gap-6">
          <span>Current</span>
          <span className="w-20 text-right">Nominal</span>
        </span>
      </div>
      {rows.map((r) => (
        <div
          key={r.k}
          className="flex items-baseline justify-between border-b border-white/5 py-1.5 font-mono uppercase tracking-[0.12em] text-[10px]"
        >
          <span className="text-white-dim">{r.k}</span>
          <span className="flex gap-6 tabular-nums">
            <span className="text-white">{r.v}</span>
            <span className="w-20 text-right text-white-faint">{r.nom}</span>
          </span>
        </div>
      ))}

      <div className="mt-3 flex items-baseline justify-between border-t border-white/10 pt-2 font-mono uppercase tracking-[0.12em] text-[10px]">
        <span className="text-white-dim">Orbit</span>
        <span className="tabular-nums text-white">
          {ship.orbit_phase.toUpperCase()} · {Math.floor(ship.orbit_t_in_phase_s)}S
        </span>
      </div>
      <div className="flex items-baseline justify-between py-1 font-mono uppercase tracking-[0.12em] text-[10px]">
        <span className="text-white-dim">Sim Clock</span>
        <span className="tabular-nums text-white">
          {Math.floor(ship.t_sim_s)}S
        </span>
      </div>
      <div className="flex items-baseline justify-between py-1 font-mono uppercase tracking-[0.12em] text-[10px]">
        <span className="text-white-dim">Crew</span>
        <span className="tabular-nums text-white">{ship.crew_count}</span>
      </div>

      {ship.active_anomalies.length > 0 && (
        <div className="mt-3 border-t border-white/10 pt-3">
          <div className="mb-2 font-mono uppercase tracking-[0.18em] text-[9px] text-white-dim">
            Active Anomalies
          </div>
          <div className="flex flex-wrap gap-2">
            {ship.active_anomalies.map((a) => (
              <span
                key={a}
                className="border-[0.5px] border-white/50 px-2 py-0.5 font-mono uppercase tracking-[0.12em] text-[9px] text-white"
              >
                {a.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
