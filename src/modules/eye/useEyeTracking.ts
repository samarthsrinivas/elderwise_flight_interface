import { useCallback, useEffect, useRef, useState } from "react";
import { FaceLandmarkerUnavailableError, loadFaceLandmarkDetector } from "../../lib/faceLandmarker";
import type { FaceLandmarkDetector } from "../../lib/faceLandmarker";
import { toMessage } from "../../lib/errors";
import type { EyeTaskId, EyeTaskResult } from "../assessment/types";
import { analyzeEyeTask } from "./analyze";
import { gazeFromLandmarks } from "./gaze";
import type { GazePoint, GazeSample } from "./gaze";
import { scheduleFor } from "./tasks";
import type { TargetSchedule } from "./tasks";

export type EyePhase = "idle" | "requesting" | "loading-model" | "running" | "analyzing" | "done" | "error";

export function useEyeTracking() {
  const [phase, setPhase] = useState<EyePhase>("idle");
  const [task, setTask] = useState<EyeTaskId | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [target, setTarget] = useState<GazePoint | null>(null);
  const [faceDetected, setFaceDetected] = useState(false);
  const [results, setResults] = useState<EyeTaskResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const detector = useRef<FaceLandmarkDetector | null>(null);
  const active = useRef<AbortController | null>(null);
  const frameId = useRef(0);
  const mounted = useRef(true);
  // Canvas and sampling share the exact clock without React updates per frame.
  const timelineRef = useRef<{ readonly schedule: TargetSchedule; readonly startedAt: number } | null>(null);

  const release = useCallback(() => {
    active.current?.abort();
    active.current = null;
    cancelAnimationFrame(frameId.current);
    timelineRef.current = null;
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    detector.current?.close();
    detector.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const cancel = useCallback(() => {
    release();
    setPhase("idle");
    setTask(null);
    setTarget(null);
    setElapsedMs(0);
    setFaceDetected(false);
    setError(null);
  }, [release]);

  const reset = useCallback(() => { cancel(); setResults([]); }, [cancel]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; release(); };
  }, [release]);

  const runTask = useCallback(async (id: EyeTaskId): Promise<EyeTaskResult> => {
    if (active.current) throw new DOMException("An eye task is already running.", "InvalidStateError");
    const operation = new AbortController();
    active.current = operation;
    const { signal } = operation;
    const schedule = scheduleFor(id);
    setError(null);
    setTask(id);
    setElapsedMs(0);
    setTarget(null);
    setFaceDetected(false);
    setPhase("requesting");
    const aborted = new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Eye task cancelled.", "AbortError")), { once: true });
    });
    const prepare = async () => {
      if (!navigator.mediaDevices?.getUserMedia) throw new DOMException("Camera access requires a secure context and camera support.", "NotSupportedError");
      if (!stream.current) {
        const acquired = await navigator.mediaDevices.getUserMedia({ audio: false,
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } } });
        if (signal.aborted) { acquired.getTracks().forEach(track => track.stop()); signal.throwIfAborted(); }
        stream.current = acquired;
      }
      const video = videoRef.current;
      if (!video) throw new DOMException("Mount the eye camera preview before starting a task.", "InvalidStateError");
      video.srcObject = stream.current;
      await video.play();
      signal.throwIfAborted();
      setPhase("loading-model");
      const loaded = detector.current ?? await loadFaceLandmarkDetector();
      if (signal.aborted) { loaded.close(); signal.throwIfAborted(); }
      detector.current = loaded;
      return { video, loaded };
    };
    try {
      const { video, loaded } = await Promise.race([prepare(), aborted]);
      signal.throwIfAborted();
      const startedAt = performance.now();
      timelineRef.current = { schedule, startedAt };
      setPhase("running");
      setTarget(schedule.targetAt(0));
      const samples: GazeSample[] = [];
      let lastSample = -Infinity;
      let lastUi = startedAt;
      let lastVideoTime = -1;
      let detected = false;
      await Promise.race([new Promise<void>((resolve, reject) => {
        const tick = (now: number) => {
          if (signal.aborted) return;
          try {
            const elapsed = Math.min(schedule.durationMs, now - startedAt);
            if (now - lastSample >= 1000 / 30) {
              const frame = video.readyState >= 2 && video.currentTime !== lastVideoTime ? loaded.detect(video, now) : null;
              lastVideoTime = video.currentTime;
              const gaze = frame ? gazeFromLandmarks(frame.landmarks, frame.blendshapes) : { x: 0.5, y: 0.5, blink: false };
              detected = frame !== null && Number.isFinite(gaze.x) && Number.isFinite(gaze.y);
              samples.push({ t: elapsed, ...gaze, valid: detected });
              lastSample = now;
            }
            if (now - lastUi >= 100) {
              setElapsedMs(elapsed);
              setTarget(schedule.targetAt(elapsed));
              setFaceDetected(detected);
              lastUi = now;
            }
            if (elapsed >= schedule.durationMs) { resolve(); return; }
            frameId.current = requestAnimationFrame(tick);
          } catch (raised: unknown) { reject(raised instanceof Error ? raised : new Error(toMessage(raised))); }
        };
        frameId.current = requestAnimationFrame(tick);
      }), aborted]);
      signal.throwIfAborted();
      timelineRef.current = null;
      setPhase("analyzing");
      const result = analyzeEyeTask(schedule, samples);
      setResults(previous => [...previous.filter(value => value.task !== id), result]);
      setElapsedMs(schedule.durationMs);
      setTarget(null);
      setPhase("done");
      return result;
    } catch (raised: unknown) {
      if (!signal.aborted && mounted.current) {
        release();
        setError(raised instanceof FaceLandmarkerUnavailableError
          ? "The local face model could not load. Run bun run models:fetch, then retry. No video was uploaded."
          : toMessage(raised));
        setTarget(null);
        setFaceDetected(false);
        setPhase("error");
      }
      throw raised;
    } finally {
      if (active.current === operation) active.current = null;
    }
  }, [release]);

  return { phase, task, elapsedMs, target, faceDetected, results, error, videoRef, timelineRef, runTask, cancel, reset };
}
