"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Phase = "idle" | "recording" | "thinking" | "speaking" | "error";

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

function speak(text: string, onDone: () => void) {
  if (!text || typeof window === "undefined" || !window.speechSynthesis) {
    onDone();
    return;
  }
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 1.0;
  utter.pitch = 0.9;
  utter.onend = onDone;
  utter.onerror = onDone;
  window.speechSynthesis.speak(utter);
}

function Waveform({ analyser }: { analyser: AnalyserNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener("resize", resize);

    const buf = new Uint8Array(analyser.fftSize);
    let raf = 0;

    const draw = () => {
      analyser.getByteTimeDomainData(buf);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(180, 230, 255, 0.95)";
      ctx.shadowColor = "rgba(120, 200, 255, 0.6)";
      ctx.shadowBlur = 12;
      ctx.beginPath();
      const step = w / buf.length;
      for (let i = 0; i < buf.length; i++) {
        const v = buf[i] / 128 - 1;
        const x = i * step;
        const y = h / 2 + v * (h / 2) * 0.9;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [analyser]);

  return <canvas ref={canvasRef} className="w-[520px] h-24" />;
}

export default function HalVoice() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [reply, setReply] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setAnalyser(null);
  }, []);

  const startRecording = useCallback(async () => {
    try {
      setError("");
      setReply("");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const node = audioCtx.createAnalyser();
      node.fftSize = 2048;
      source.connect(node);
      setAnalyser(node);

      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        cleanupStream();
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
          const text = (json.reply as string | undefined) ?? "";
          setReply(text);
          setPhase("speaking");
          speak(text, () => setPhase("idle"));
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          setPhase("error");
        }
      };
      recorderRef.current = rec;
      rec.start();
      setPhase("recording");
    } catch (e) {
      cleanupStream();
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, [cleanupStream]);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current = null;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      e.preventDefault();
      if (phase === "recording") stopRecording();
      else if (phase === "idle" || phase === "error") startRecording();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, startRecording, stopRecording]);

  useEffect(() => () => cleanupStream(), [cleanupStream]);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-3 p-6 font-mono text-sm text-white">
      {phase === "recording" && analyser && (
        <div className="pointer-events-auto flex flex-col items-center gap-2">
          <Waveform analyser={analyser} />
          <div className="flex items-center gap-3 bg-black/70 border border-white/60 px-3 py-1.5 text-xs">
            <span>
              Listening — <kbd className="px-1 border border-white/40">Enter</kbd> to stop
            </span>
            <button
              type="button"
              onClick={stopRecording}
              aria-label="Stop recording"
              className="ml-1 w-6 h-6 flex items-center justify-center border border-white/40 hover:bg-white/10"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {phase === "thinking" && (
        <div className="bg-black/70 border border-white/50 px-3 py-2 text-xs tracking-widest">
          HAL is thinking…
        </div>
      )}

      {reply && (phase === "speaking" || phase === "idle") && (
        <div className="pointer-events-auto max-w-xl text-center bg-black/70 border border-white/40 px-4 py-3">
          {reply}
        </div>
      )}

      {error && <div className="text-red-300 text-xs">{error}</div>}
    </div>
  );
}
