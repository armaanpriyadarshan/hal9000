import type { MutableRefObject } from "react";

export type Phase = "idle" | "recording" | "thinking" | "speaking";

type Target = {
  ringR: number;
  ringAmp: number;
  ringAlpha: number;
  eyeR: number;
  eyePulse: number;
};

export const CANVAS_PX = 340;
const EYE_R = 44;
const BLACK_R = 70;
const RING_R = 70;
const RING_AMP_REC = 28;
const RING_AMP_SPK = 42;

const PHASE_TARGET: Record<Phase, Target> = {
  idle:      { ringR: 0,      ringAmp: 0,           ringAlpha: 0, eyeR: 0,     eyePulse: 0 },
  recording: { ringR: RING_R, ringAmp: RING_AMP_REC, ringAlpha: 1, eyeR: EYE_R, eyePulse: 0 },
  thinking:  { ringR: EYE_R,  ringAmp: 0,           ringAlpha: 0, eyeR: EYE_R, eyePulse: 0.18 },
  speaking:  { ringR: RING_R, ringAmp: RING_AMP_SPK, ringAlpha: 1, eyeR: EYE_R, eyePulse: 0 },
};

const WAVE_POINTS = 128;

export type VisualizerRefs = {
  canvas: HTMLCanvasElement;
  phaseRef: MutableRefObject<Phase>;
  analyserRef: MutableRefObject<AnalyserNode | null>;
};

export function attachVisualizer({ canvas, phaseRef, analyserRef }: VisualizerRefs): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};

  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const resize = () => {
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
  };
  resize();
  window.addEventListener("resize", resize);

  const timeBuf = new Uint8Array(1024);
  const smoothed = new Float32Array(WAVE_POINTS);
  const s = { ringR: 0, ringAmp: 0, ringAlpha: 0, eyeR: 0, eyePulse: 0 };
  let pulsePhase = 0;
  let lastT = performance.now();
  let raf = 0;

  const lerp = (cur: number, to: number, k: number, dt: number) =>
    cur + (to - cur) * Math.min(1, dt * k);

  const drawRing = (cx: number, cy: number) => {
    const live = analyserRef.current;
    const ph = phaseRef.current;
    const haveAudio = !!live && (ph === "recording" || ph === "speaking");
    if (haveAudio && live) live.getByteTimeDomainData(timeBuf);

    const samplesPerPoint = Math.max(1, Math.floor(timeBuf.length / WAVE_POINTS));
    for (let i = 0; i < WAVE_POINTS; i++) {
      let val = 0;
      if (haveAudio) {
        const base = i * samplesPerPoint;
        let peak = 0;
        for (let j = 0; j < samplesPerPoint; j++) {
          const v = Math.abs((timeBuf[base + j] || 128) - 128) / 128;
          if (v > peak) peak = v;
        }
        val = peak;
      }
      smoothed[i] = smoothed[i] * 0.3 + val * 0.7;
    }

    const baseR = s.ringR * dpr;
    const ampPx = s.ringAmp * 1.8 * dpr;

    ctx.globalAlpha = s.ringAlpha;
    ctx.lineWidth = 2.5 * dpr;
    ctx.strokeStyle = "rgba(255, 120, 80, 1)";
    ctx.shadowColor = "rgba(255, 70, 30, 0.95)";
    ctx.shadowBlur = 18 * dpr;
    ctx.beginPath();
    for (let i = 0; i <= WAVE_POINTS; i++) {
      const idx = i % WAVE_POINTS;
      const a = (idx / WAVE_POINTS) * Math.PI * 2 - Math.PI / 2;
      const r = baseR + smoothed[idx] * ampPx;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  const drawEye = (cx: number, cy: number, pulse: number) => {
    const eyeR = s.eyeR * pulse * dpr;
    const blackR = eyeR * (BLACK_R / EYE_R);
    const fadeR = blackR * 1.3;

    // Black surround — soft feathered edge, scales with eye
    ctx.shadowBlur = 0;
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, fadeR);
    bg.addColorStop(0, "rgba(0, 0, 0, 1)");
    bg.addColorStop(0.7, "rgba(0, 0, 0, 1)");
    bg.addColorStop(0.85, "rgba(0, 0, 0, 0.6)");
    bg.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(cx, cy, fadeR, 0, Math.PI * 2);
    ctx.fill();

    // Red glow
    const disc = ctx.createRadialGradient(cx, cy, 0, cx, cy, eyeR);
    disc.addColorStop(0, "rgba(255, 200, 50, 1)");
    disc.addColorStop(0.06, "rgba(255, 160, 30, 1)");
    disc.addColorStop(0.15, "rgba(230, 60, 10, 1)");
    disc.addColorStop(0.35, "rgba(180, 15, 0, 1)");
    disc.addColorStop(0.6, "rgba(80, 5, 0, 0.8)");
    disc.addColorStop(0.8, "rgba(20, 0, 0, 0.3)");
    disc.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.shadowColor = "rgba(255, 40, 10, 0.6)";
    ctx.shadowBlur = 25 * dpr;
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(cx, cy, eyeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Bright center dot
    const dotR = 4 * dpr;
    const dot = ctx.createRadialGradient(cx, cy, 0, cx, cy, dotR);
    dot.addColorStop(0, "rgba(255, 255, 200, 1)");
    dot.addColorStop(0.5, "rgba(255, 200, 50, 0.8)");
    dot.addColorStop(1, "rgba(255, 160, 30, 0)");
    ctx.fillStyle = dot;
    ctx.beginPath();
    ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
    ctx.fill();
  };

  const draw = (t: number) => {
    const dt = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;
    const tgt = PHASE_TARGET[phaseRef.current];

    s.ringR     = lerp(s.ringR,     tgt.ringR,     8,  dt);
    s.ringAmp   = lerp(s.ringAmp,   tgt.ringAmp,   7,  dt);
    s.ringAlpha = lerp(s.ringAlpha, tgt.ringAlpha, 9,  dt);
    s.eyeR      = lerp(s.eyeR,      tgt.eyeR,      10, dt);
    s.eyePulse  = lerp(s.eyePulse,  tgt.eyePulse,  6,  dt);

    pulsePhase += dt * 4.2;
    const pulse = 1 + Math.sin(pulsePhase) * s.eyePulse;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (s.eyeR < 0.6 && s.ringAlpha < 0.01) {
      raf = requestAnimationFrame(draw);
      return;
    }

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    if (s.ringAlpha > 0.01 && s.ringR > 0.5) drawRing(cx, cy);
    if (s.eyeR > 0.5) drawEye(cx, cy, pulse);

    raf = requestAnimationFrame(draw);
  };

  raf = requestAnimationFrame(draw);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
  };
}
