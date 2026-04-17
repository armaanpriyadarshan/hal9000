"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Phase = "idle" | "recording" | "thinking" | "speaking";

const SERVER = "http://10.21.80.88:8000";
const TARGET_SAMPLE_RATE = 16_000;

async function blobToInt16Pcm(blob: Blob): Promise<ArrayBuffer> {
  const arrayBuffer = await blob.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, TARGET_SAMPLE_RATE);
  const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
  let samples: Float32Array;
  if (decoded.sampleRate === TARGET_SAMPLE_RATE && decoded.numberOfChannels === 1) {
    samples = decoded.getChannelData(0);
  } else {
    const offline = new OfflineAudioContext(
      1,
      Math.ceil(decoded.duration * TARGET_SAMPLE_RATE),
      TARGET_SAMPLE_RATE,
    );
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start();
    const rendered = await offline.startRendering();
    samples = rendered.getChannelData(0);
  }
  const int16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    int16[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return int16.buffer;
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

type Target = {
  ringR: number;
  ringAmp: number;
  ringAlpha: number;
  eyeR: number;
  eyePulse: number;
};

const CANVAS_PX = 340;
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

export default function HalVoice() {
  const [, setPhase] = useState<Phase>("idle");

  const phaseRef = useRef<Phase>("idle");
  const setPhaseBoth = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const playingSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);
  const speakingTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const resize = () => {
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    };
    resize();
    window.addEventListener("resize", resize);

    const WAVE_POINTS = 128;
    const timeBuf = new Uint8Array(1024);
    const smoothed = new Float32Array(WAVE_POINTS);
    const s = { ringR: 0, ringAmp: 0, ringAlpha: 0, eyeR: 0, eyePulse: 0 };
    let pulsePhase = 0;
    let lastT = performance.now();
    let raf = 0;

    const draw = (t: number) => {
      const dt = Math.min(0.05, (t - lastT) / 1000);
      lastT = t;
      const tgt = PHASE_TARGET[phaseRef.current];

      const lerp = (cur: number, to: number, k: number) =>
        cur + (to - cur) * Math.min(1, dt * k);
      s.ringR     = lerp(s.ringR,     tgt.ringR,     8);
      s.ringAmp   = lerp(s.ringAmp,   tgt.ringAmp,   7);
      s.ringAlpha = lerp(s.ringAlpha, tgt.ringAlpha, 9);
      s.eyeR      = lerp(s.eyeR,      tgt.eyeR,      10);
      s.eyePulse  = lerp(s.eyePulse,  tgt.eyePulse,  6);

      pulsePhase += dt * 4.2;
      const pulse = 1 + Math.sin(pulsePhase) * s.eyePulse;

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      if (s.eyeR < 0.6 && s.ringAlpha < 0.01) {
        raf = requestAnimationFrame(draw);
        return;
      }

      const cx = w / 2;
      const cy = h / 2;

      // Circular waveform
      if (s.ringAlpha > 0.01 && s.ringR > 0.5) {
        const live = analyserRef.current;
        const ph = phaseRef.current;
        let haveAudio = false;
        if (live && (ph === "recording" || ph === "speaking")) {
          live.getByteTimeDomainData(timeBuf);
          haveAudio = true;
        }

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
      }

      // HAL eye
      if (s.eyeR > 0.5) {
        const eyeR = s.eyeR * pulse * dpr;
        const blackR = BLACK_R * dpr;

        // Black disc behind the eye
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#000";
        ctx.beginPath();
        ctx.arc(cx, cy, blackR, 0, Math.PI * 2);
        ctx.fill();

        // Red disc — gradient spans eyeR, fades to black at edge
        const disc = ctx.createRadialGradient(cx, cy, 0, cx, cy, eyeR);
        disc.addColorStop(0, "rgba(255, 200, 50, 1)");
        disc.addColorStop(0.06, "rgba(255, 160, 30, 1)");
        disc.addColorStop(0.15, "rgba(230, 60, 10, 1)");
        disc.addColorStop(0.35, "rgba(180, 15, 0, 1)");
        disc.addColorStop(0.6, "rgba(80, 5, 0, 0.8)");
        disc.addColorStop(0.8, "rgba(20, 0, 0, 0.3)");
        disc.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.shadowColor = "rgba(255, 40, 10, 0.8)";
        ctx.shadowBlur = 30 * dpr;
        ctx.fillStyle = disc;
        ctx.beginPath();
        ctx.arc(cx, cy, eyeR, 0, Math.PI * 2);
        ctx.fill();

        // Bright center dot
        ctx.shadowBlur = 12 * dpr;
        ctx.shadowColor = "rgba(255, 220, 80, 0.9)";
        const dotR = 4 * dpr;
        const dot = ctx.createRadialGradient(cx, cy, 0, cx, cy, dotR);
        dot.addColorStop(0, "rgba(255, 255, 200, 1)");
        dot.addColorStop(0.5, "rgba(255, 200, 50, 0.8)");
        dot.addColorStop(1, "rgba(255, 160, 30, 0)");
        ctx.fillStyle = dot;
        ctx.beginPath();
        ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  const stopInputStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    analyserRef.current = null;
  }, []);

  const getAudioCtx = useCallback(async () => {
    let ac = audioCtxRef.current;
    if (!ac) {
      ac = new AudioContext();
      audioCtxRef.current = ac;
    }
    if (ac.state === "suspended") await ac.resume();
    return ac;
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ac = await getAudioCtx();
      const src = ac.createMediaStreamSource(stream);
      const node = ac.createAnalyser();
      node.fftSize = 2048;
      node.smoothingTimeConstant = 0.5;
      src.connect(node);
      analyserRef.current = node;

      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        stopInputStream();
        if (cancelledRef.current) {
          cancelledRef.current = false;
          setPhaseBoth("idle");
          return;
        }
        setPhaseBoth("thinking");
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        try {
          const pcm = await blobToInt16Pcm(blob);
          const res = await fetch(`${SERVER}/api/voice`, {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: pcm,
            signal: ctrl.signal,
          });
          if (!res.ok) throw new Error(`server ${res.status}`);
          const json = await res.json();
          if (cancelledRef.current) { cancelledRef.current = false; return; }
          const audioB64 = json.audio as string | undefined;
          if (!audioB64) {
            setPhaseBoth("idle");
            return;
          }
          const ac2 = await getAudioCtx();
          const audioBuf = await ac2.decodeAudioData(base64ToArrayBuffer(audioB64));
          if (cancelledRef.current) { cancelledRef.current = false; return; }
          const src2 = ac2.createBufferSource();
          const ana = ac2.createAnalyser();
          ana.fftSize = 1024;
          ana.smoothingTimeConstant = 0.35;
          src2.buffer = audioBuf;
          src2.connect(ana);
          ana.connect(ac2.destination);
          analyserRef.current = ana;
          playingSourceRef.current = src2;
          setPhaseBoth("speaking");
          src2.start();
          const durationMs = Math.max(500, audioBuf.duration * 1000 + 250);
          speakingTimeoutRef.current = window.setTimeout(() => {
            if (phaseRef.current !== "speaking") return;
            try { playingSourceRef.current?.stop(); } catch {}
            analyserRef.current = null;
            playingSourceRef.current = null;
            setPhaseBoth("idle");
          }, durationMs);
        } catch (err) {
          stopInputStream();
          if ((err as Error).name !== "AbortError") setPhaseBoth("idle");
        } finally {
          abortRef.current = null;
        }
      };
      recorderRef.current = rec;
      rec.start();
      setPhaseBoth("recording");
    } catch {
      stopInputStream();
      setPhaseBoth("idle");
    }
  }, [getAudioCtx, stopInputStream]);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    abortRef.current?.abort();
    if (speakingTimeoutRef.current !== null) {
      window.clearTimeout(speakingTimeoutRef.current);
      speakingTimeoutRef.current = null;
    }
    try { recorderRef.current?.stop(); } catch {}
    recorderRef.current = null;
    try { playingSourceRef.current?.stop(); } catch {}
    playingSourceRef.current = null;
    stopInputStream();
    setPhaseBoth("idle");
  }, [stopInputStream]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "Escape") {
        if (phaseRef.current !== "idle") {
          e.preventDefault();
          cancel();
        }
        return;
      }
      if (e.key !== " " && e.code !== "Space") return;
      if (e.repeat) return;
      e.preventDefault();
      const cur = phaseRef.current;
      if (cur === "recording") stopRecording();
      else if (cur === "idle") startRecording();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancel, startRecording, stopRecording]);

  useEffect(() => {
    return () => {
      recorderRef.current?.stop();
      playingSourceRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed left-1/2 bottom-10 z-10 -translate-x-1/2"
      style={{ width: CANVAS_PX, height: CANVAS_PX }}
    >
      <canvas ref={canvasRef} className="w-full h-full" />
    </div>
  );
}
