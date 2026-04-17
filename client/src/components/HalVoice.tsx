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

// VAD: RMS threshold in [0,1] on 8-bit time-domain (127-centered) samples.
// Needs N consecutive above-threshold frames to start, M below to stop.
const VAD_START_RMS = 0.06;
const VAD_STOP_RMS = 0.025;
const VAD_START_FRAMES = 3; // ~150 ms at rAF 60 Hz
const VAD_STOP_FRAMES = 55; // ~900 ms of silence before stopping a recording

export default function HalVoice() {
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
  const vadRafRef = useRef<number | null>(null);
  const vadAboveRef = useRef(0);
  const vadBelowRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return attachVisualizer({ canvas, phaseRef, analyserRef });
  }, []);

  const stopVadLoop = useCallback(() => {
    if (vadRafRef.current !== null) {
      cancelAnimationFrame(vadRafRef.current);
      vadRafRef.current = null;
    }
  }, []);

  const stopMicStream = useCallback(() => {
    stopVadLoop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    micAnalyserRef.current = null;
    analyserRef.current = null;
  }, [stopVadLoop]);

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

  /** Grab the mic once (needs a user gesture) and keep it live for the
   *  rest of the session so VAD can drive recording automatically. */
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
      vadAboveRef.current = 0;
      vadBelowRef.current = 0;
      phaseRef.current = "recording";
    } catch {
      stopMicStream();
      phaseRef.current = "idle";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        // Hand the visualizer back to the mic analyser + return to ready.
        analyserRef.current = micAnalyserRef.current;
        phaseRef.current = "ready";
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
          phaseRef.current = "ready";
          return;
        }
        await playReplyAudio(json.audio);
      } catch (err) {
        if ((err as Error).name !== "AbortError") phaseRef.current = "ready";
      } finally {
        abortRef.current = null;
      }
    },
    [playReplyAudio],
  );

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    abortRef.current?.abort();
    clearSpeakingTimeout();
    try { recorderRef.current?.stop(); } catch {}
    recorderRef.current = null;
    try { playingSourceRef.current?.stop(); } catch {}
    playingSourceRef.current = null;
    stopMicStream();
    phaseRef.current = "idle";
  }, [clearSpeakingTimeout, stopMicStream]);

  // Any first user interaction (click, key, touch) unlocks the mic. After
  // that, VAD drives the rest — the user never has to hit Space.
  useEffect(() => {
    const bootstrap = async () => {
      if (phaseRef.current !== "idle") return;
      try {
        await ensureMicStream();
        phaseRef.current = "ready";
      } catch {
        stopMicStream();
      }
    };
    window.addEventListener("click", bootstrap);
    window.addEventListener("keydown", bootstrap);
    window.addEventListener("touchstart", bootstrap);
    return () => {
      window.removeEventListener("click", bootstrap);
      window.removeEventListener("keydown", bootstrap);
      window.removeEventListener("touchstart", bootstrap);
    };
  }, [ensureMicStream, stopMicStream]);

  // VAD loop: runs continuously, only acts when phase is ready or recording.
  // In `ready`, triggers startRecording on sustained speech.
  // In `recording`, triggers stopRecording on sustained silence.
  useEffect(() => {
    const tick = () => {
      vadRafRef.current = requestAnimationFrame(tick);
      const ana = micAnalyserRef.current;
      const ph = phaseRef.current;
      if (!ana || (ph !== "ready" && ph !== "recording")) {
        vadAboveRef.current = 0;
        vadBelowRef.current = 0;
        return;
      }
      const buf = new Uint8Array(ana.fftSize);
      ana.getByteTimeDomainData(buf);
      let sumSq = 0;
      for (let i = 0; i < buf.length; i++) {
        const s = (buf[i] - 128) / 128;
        sumSq += s * s;
      }
      const rms = Math.sqrt(sumSq / buf.length);

      if (ph === "ready") {
        if (rms > VAD_START_RMS) {
          vadAboveRef.current++;
          vadBelowRef.current = 0;
          if (vadAboveRef.current >= VAD_START_FRAMES) {
            vadAboveRef.current = 0;
            startRecording();
          }
        } else {
          vadAboveRef.current = 0;
        }
      } else if (ph === "recording") {
        if (rms < VAD_STOP_RMS) {
          vadBelowRef.current++;
          vadAboveRef.current = 0;
          if (vadBelowRef.current >= VAD_STOP_FRAMES) {
            vadBelowRef.current = 0;
            stopRecording();
          }
        } else {
          vadBelowRef.current = 0;
        }
      }
    };
    vadRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (vadRafRef.current !== null) cancelAnimationFrame(vadRafRef.current);
    };
  }, [startRecording, stopRecording]);

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
      else if (cur === "idle") {
        // First gesture: grant mic, then drop into "ready" and let VAD take over.
        (async () => {
          try {
            await ensureMicStream();
            phaseRef.current = "ready";
          } catch {
            stopMicStream();
            phaseRef.current = "idle";
          }
        })();
      } else if (cur === "ready") {
        startRecording();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancel, ensureMicStream, startRecording, stopMicStream, stopRecording]);

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
