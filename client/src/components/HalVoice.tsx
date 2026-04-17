"use client";

import { useCallback, useRef, useState } from "react";

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
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE), TARGET_SAMPLE_RATE);
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

export default function HalVoice() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [reply, setReply] = useState<string>("");
  const [error, setError] = useState<string>("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = useCallback(async () => {
    try {
      setError("");
      setReply("");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
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
          const text = json.reply ?? "";
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
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, []);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current = null;
  }, []);

  const onToggle = () => {
    if (phase === "recording") stopRecording();
    else if (phase === "idle" || phase === "error") startRecording();
  };

  const label =
    phase === "idle" ? "Hold to talk to HAL"
    : phase === "recording" ? "Stop"
    : phase === "thinking" ? "HAL is thinking…"
    : phase === "speaking" ? "HAL is speaking…"
    : "Try again";

  const busy = phase === "thinking" || phase === "speaking";

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-3 font-mono text-sm text-white">
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        className="px-5 py-3 bg-black/60 border border-white/80 hover:bg-black/80 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {label}
      </button>
      {reply && (
        <div className="max-w-lg text-center bg-black/70 border border-white/40 px-4 py-3">
          {reply}
        </div>
      )}
      {error && <div className="text-red-300 text-xs">{error}</div>}
    </div>
  );
}
