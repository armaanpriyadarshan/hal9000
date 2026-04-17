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

type TargetParams = { r: number; amp: number; pulse: number };

const PHASE_TARGETS: Record<Phase, (scale: number) => TargetParams> = {
  idle: () => ({ r: 0, amp: 0, pulse: 0 }),
  recording: (s) => ({ r: 170 * s, amp: 36 * s, pulse: 0 }),
  thinking: (s) => ({ r: 14 * s, amp: 0, pulse: 0.35 }),
  speaking: (s) => ({ r: 150 * s, amp: 52 * s, pulse: 0 }),
};

export default function HalVoice() {
  const [phase, setPhase] = useState<Phase>("idle");

  const phaseRef = useRef<Phase>("idle");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const playingSourceRef = useRef<AudioBufferSourceNode | null>(null);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Visualizer render loop
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
    const onResize = () => resize();
    window.addEventListener("resize", onResize);

    const buf = new Uint8Array(256);
    let currentR = 0;
    let currentAmp = 0;
    let pulsePhase = 0;
    let lastT = performance.now();
    let raf = 0;

    const draw = (t: number) => {
      const dt = Math.min(0.05, (t - lastT) / 1000);
      lastT = t;

      const scale = Math.min(canvas.clientWidth, canvas.clientHeight) / 800;
      const tgt = PHASE_TARGETS[phaseRef.current](scale);

      currentR += (tgt.r - currentR) * Math.min(1, dt * 9);
      currentAmp += (tgt.amp - currentAmp) * Math.min(1, dt * 7);
      pulsePhase += dt * 4.2; // ~1.5 s period
      const pulseScale = 1 + Math.sin(pulsePhase) * tgt.pulse;

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      if (currentR < 1 && currentAmp < 0.5) {
        raf = requestAnimationFrame(draw);
        return;
      }

      const cx = w / 2;
      const cy = h / 2;

      let haveAudio = false;
      const live = analyserRef.current;
      const ph = phaseRef.current;
      if (live && (ph === "recording" || ph === "speaking")) {
        live.getByteTimeDomainData(buf);
        haveAudio = true;
      }

      const rBase = currentR * pulseScale * dpr;
      const ampPx = currentAmp * dpr;

      // Outer ring
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = "rgba(255, 95, 55, 0.95)";
      ctx.shadowColor = "rgba(255, 60, 30, 0.85)";
      ctx.shadowBlur = 42 * dpr;
      ctx.beginPath();
      const N = buf.length;
      for (let i = 0; i <= N; i++) {
        const idx = i % N;
        const s = haveAudio ? (buf[idx] - 128) / 128 : 0;
        const r = rBase + s * ampPx;
        const a = (i / N) * Math.PI * 2 - Math.PI / 2;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Inner glow disc
      const innerR = Math.max(2 * dpr, Math.min(rBase * 0.25, 18 * dpr)) * pulseScale;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, innerR);
      grad.addColorStop(0, "rgba(255, 160, 110, 0.95)");
      grad.addColorStop(0.4, "rgba(255, 90, 50, 0.55)");
      grad.addColorStop(1, "rgba(255, 60, 30, 0)");
      ctx.shadowBlur = 28 * dpr;
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
      ctx.fill();

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
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
        setPhase("thinking");
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
            setPhase("idle");
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
            setPhase("idle");
          };
          setPhase("speaking");
          src2.start();
        } catch {
          stopInputStream();
          setPhase("idle");
        }
      };
      recorderRef.current = rec;
      rec.start();
      setPhase("recording");
    } catch {
      stopInputStream();
      setPhase("idle");
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
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-10 w-full h-full"
    />
  );
}
