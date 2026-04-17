"use client";

import { useCallback, useEffect, useRef } from "react";

import {
  base64ToArrayBuffer,
  blobToInt16Pcm,
  defaultServerUrl,
} from "@/lib/halAudio";
import {
  CANVAS_PX,
  type Phase,
  attachVisualizer,
} from "@/lib/halVisualizer";

const SERVER = process.env.NEXT_PUBLIC_HAL_SERVER ?? defaultServerUrl();

export default function HalVoice() {
  const phaseRef = useRef<Phase>("idle");
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
    return attachVisualizer({ canvas, phaseRef, analyserRef });
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

  const clearSpeakingTimeout = useCallback(() => {
    if (speakingTimeoutRef.current !== null) {
      window.clearTimeout(speakingTimeoutRef.current);
      speakingTimeoutRef.current = null;
    }
  }, []);

  const playReplyAudio = useCallback(
    async (audioB64: string) => {
      const ac = await getAudioCtx();
      const audioBuf = await ac.decodeAudioData(base64ToArrayBuffer(audioB64));
      if (cancelledRef.current) return;

      const src = ac.createBufferSource();
      const ana = ac.createAnalyser();
      ana.fftSize = 1024;
      ana.smoothingTimeConstant = 0.35;
      src.buffer = audioBuf;
      src.connect(ana);
      ana.connect(ac.destination);

      analyserRef.current = ana;
      playingSourceRef.current = src;
      phaseRef.current = "speaking";
      src.start();

      const durationMs = Math.max(500, audioBuf.duration * 1000 + 250);
      speakingTimeoutRef.current = window.setTimeout(() => {
        if (phaseRef.current !== "speaking") return;
        try { playingSourceRef.current?.stop(); } catch {}
        analyserRef.current = null;
        playingSourceRef.current = null;
        phaseRef.current = "idle";
      }, durationMs);
    },
    [getAudioCtx],
  );

  const processRecording = useCallback(
    async (blob: Blob) => {
      if (cancelledRef.current) {
        cancelledRef.current = false;
        phaseRef.current = "idle";
        return;
      }
      phaseRef.current = "thinking";

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
        const json = (await res.json()) as { audio?: string };
        if (cancelledRef.current) { cancelledRef.current = false; return; }

        if (!json.audio) {
          phaseRef.current = "idle";
          return;
        }
        await playReplyAudio(json.audio);
      } catch (err) {
        if ((err as Error).name !== "AbortError") phaseRef.current = "idle";
      } finally {
        abortRef.current = null;
      }
    },
    [playReplyAudio],
  );

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const ac = await getAudioCtx();
      const src = ac.createMediaStreamSource(stream);
      const ana = ac.createAnalyser();
      ana.fftSize = 2048;
      ana.smoothingTimeConstant = 0.5;
      src.connect(ana);
      analyserRef.current = ana;

      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        stopInputStream();
        await processRecording(blob);
      };
      recorderRef.current = rec;
      rec.start();
      phaseRef.current = "recording";
    } catch {
      stopInputStream();
      phaseRef.current = "idle";
    }
  }, [getAudioCtx, processRecording, stopInputStream]);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    abortRef.current?.abort();
    clearSpeakingTimeout();
    try { recorderRef.current?.stop(); } catch {}
    recorderRef.current = null;
    try { playingSourceRef.current?.stop(); } catch {}
    playingSourceRef.current = null;
    stopInputStream();
    phaseRef.current = "idle";
  }, [clearSpeakingTimeout, stopInputStream]);

  useEffect(() => {
    const isEditable = (el: EventTarget | null) => {
      const node = el as HTMLElement | null;
      return (
        !!node &&
        (node.tagName === "INPUT" ||
          node.tagName === "TEXTAREA" ||
          node.isContentEditable)
      );
    };
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
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
