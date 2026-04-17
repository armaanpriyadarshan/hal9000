"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Phase = "idle" | "recording" | "thinking" | "speaking";

const SERVER = process.env.NEXT_PUBLIC_HAL_SERVER ?? "http://localhost:8000";
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
const RING_R = 105;
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

    const buf = new Uint8Array(256);
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

      // Waveform ring (outer)
      if (s.ringAlpha > 0.01 && s.ringR > 0.5) {
        let haveAudio = false;
        const live = analyserRef.current;
        const ph = phaseRef.current;
        if (live && (ph === "recording" || ph === "speaking")) {
          live.getByteTimeDomainData(buf);
          haveAudio = true;
        }
        ctx.globalAlpha = s.ringAlpha;
        ctx.lineWidth = 2 * dpr;
        ctx.strokeStyle = "rgba(255, 110, 70, 1)";
        ctx.shadowColor = "rgba(255, 60, 30, 0.95)";
        ctx.shadowBlur = 28 * dpr;
        ctx.beginPath();
        const N = buf.length;
        for (let i = 0; i <= N; i++) {
          const idx = i % N;
          const v = haveAudio ? (buf[idx] - 128) / 128 : 0;
          const r = (s.ringR + v * s.ringAmp) * dpr;
          const a = (i / N) * Math.PI * 2 - Math.PI / 2;
          const x = cx + Math.cos(a) * r;
          const y = cy + Math.sin(a) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // HAL eye (inner red disc with glow)
      if (s.eyeR > 0.5) {
        const eyeR = s.eyeR * pulse * dpr;
        const haloR = eyeR * 1.8;
        // outer halo
        const halo = ctx.createRadialGradient(cx, cy, eyeR * 0.85, cx, cy, haloR);
        halo.addColorStop(0, "rgba(255, 70, 30, 0.55)");
        halo.addColorStop(1, "rgba(255, 40, 10, 0)");
        ctx.shadowBlur = 0;
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
        ctx.fill();
        // disc
        const disc = ctx.createRadialGradient(cx, cy, 0, cx, cy, eyeR);
        disc.addColorStop(0, "rgba(255, 230, 180, 1)");
        disc.addColorStop(0.25, "rgba(255, 140, 70, 1)");
        disc.addColorStop(0.7, "rgba(210, 35, 10, 1)");
        disc.addColorStop(1, "rgba(90, 10, 0, 1)");
        ctx.shadowColor = "rgba(255, 60, 20, 0.95)";
        ctx.shadowBlur = 36 * dpr;
        ctx.fillStyle = disc;
        ctx.beginPath();
        ctx.arc(cx, cy, eyeR, 0, Math.PI * 2);
        ctx.fill();
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
      node.fftSize = 512;
      src.connect(node);
      analyserRef.current = node;

      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        stopInputStream();
        setPhaseBoth("thinking");
        try {
          const pcm = await blobToInt16Pcm(blob);
          const res = await fetch(`${SERVER}/api/voice`, {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: pcm,
          });
          if (!res.ok) throw new Error(`server ${res.status}`);
          const json = await res.json();
          const audioB64 = json.audio as string | undefined;
          if (!audioB64) {
            setPhaseBoth("idle");
            return;
          }
          const ac2 = await getAudioCtx();
          const audioBuf = await ac2.decodeAudioData(base64ToArrayBuffer(audioB64));
          const src2 = ac2.createBufferSource();
          const ana = ac2.createAnalyser();
          ana.fftSize = 512;
          src2.buffer = audioBuf;
          src2.connect(ana);
          ana.connect(ac2.destination);
          analyserRef.current = ana;
          playingSourceRef.current = src2;
          src2.onended = () => {
            analyserRef.current = null;
            playingSourceRef.current = null;
            setPhaseBoth("idle");
          };
          setPhaseBoth("speaking");
          src2.start();
        } catch {
          stopInputStream();
          setPhaseBoth("idle");
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      const cur = phaseRef.current;
      if (cur === "recording") stopRecording();
      else if (cur === "idle") startRecording();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [startRecording, stopRecording]);

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
