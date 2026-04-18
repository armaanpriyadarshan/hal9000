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
import { useRouter } from "next/navigation";
import { executeClientDirectives, type ClientDirective } from "@/lib/halTools";

const SERVER = process.env.NEXT_PUBLIC_HAL_SERVER ?? defaultServerUrl();
const READY_IDLE_MS = 6000;

export default function HalVoice() {
  const router = useRouter();
  const phaseRef = useRef<Phase>("idle");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const playingSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);
  const speakingTimeoutRef = useRef<number | null>(null);
  const idleTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return attachVisualizer({ canvas, phaseRef, analyserRef });
  }, []);

  const stopMicStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    micAnalyserRef.current = null;
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

  const clearIdleTimer = useCallback(() => {
    if (idleTimeoutRef.current !== null) {
      window.clearTimeout(idleTimeoutRef.current);
      idleTimeoutRef.current = null;
    }
  }, []);

  const scheduleIdleFade = useCallback(() => {
    clearIdleTimer();
    idleTimeoutRef.current = window.setTimeout(() => {
      idleTimeoutRef.current = null;
      if (phaseRef.current === "ready") {
        phaseRef.current = "idle";
      }
    }, READY_IDLE_MS);
  }, [clearIdleTimer]);

  const enterReady = useCallback(() => {
    phaseRef.current = "ready";
    scheduleIdleFade();
  }, [scheduleIdleFade]);

  /** Grab the mic once (needs a user gesture) and keep it live. The
   *  visualizer reads from its analyser during recording; the stream
   *  is reused across turns so the user only grants permission once. */
  const ensureMicStream = useCallback(async () => {
    if (streamRef.current && micAnalyserRef.current) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    streamRef.current = stream;
    const ac = await getAudioCtx();
    const src = ac.createMediaStreamSource(stream);
    const ana = ac.createAnalyser();
    ana.fftSize = 2048;
    ana.smoothingTimeConstant = 0.5;
    src.connect(ana);
    micAnalyserRef.current = ana;
    analyserRef.current = ana;
  }, [getAudioCtx]);

  const startRecording = useCallback(async () => {
    clearIdleTimer();
    try {
      await ensureMicStream();
      const stream = streamRef.current;
      if (!stream) throw new Error("no mic stream");
      analyserRef.current = micAnalyserRef.current;

      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        await processRecording(blob);
      };
      recorderRef.current = rec;
      rec.start();
      phaseRef.current = "recording";
    } catch {
      stopMicStream();
      phaseRef.current = "idle";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearIdleTimer]);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current = null;
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
        playingSourceRef.current = null;
        analyserRef.current = micAnalyserRef.current;
        enterReady();
      }, durationMs);
    },
    [enterReady, getAudioCtx],
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
        const json = (await res.json()) as {
          audio?: string;
          client_directives?: ClientDirective[];
        };
        if (cancelledRef.current) { cancelledRef.current = false; return; }

        executeClientDirectives(json.client_directives ?? [], { router });

        if (!json.audio) {
          enterReady();
          return;
        }
        await playReplyAudio(json.audio);
      } catch (err) {
        if ((err as Error).name !== "AbortError") enterReady();
      } finally {
        abortRef.current = null;
      }
    },
    [enterReady, playReplyAudio, router],
  );

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    abortRef.current?.abort();
    clearSpeakingTimeout();
    clearIdleTimer();
    try { recorderRef.current?.stop(); } catch {}
    recorderRef.current = null;
    try { playingSourceRef.current?.stop(); } catch {}
    playingSourceRef.current = null;
    stopMicStream();
    phaseRef.current = "idle";
  }, [clearIdleTimer, clearSpeakingTimeout, stopMicStream]);

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
      if (cur === "recording") {
        stopRecording();
      } else if (cur === "idle" || cur === "ready") {
        startRecording();
      }
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
