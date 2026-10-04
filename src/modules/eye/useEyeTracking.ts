import { useCallback, useEffect, useRef, useState } from "react";
import { FaceLandmarkerUnavailableError, loadFaceLandmarkDetector } from "../../lib/faceLandmarker";
import type { FaceLandmarkDetector } from "../../lib/faceLandmarker";
import { toMessage } from "../../lib/errors";
import { headPoseDeviationDeg } from "../../lib/headPose";
import type { EyeTaskId, EyeTaskResult, GazeCalibration } from "../assessment/types";
import { analyzeEyeTask } from "./analyze";
import { HEAD_POSE_TOLERANCE_DEG, calibrationSchedule, fitCalibration } from "./calibration";
import { gazeFromLandmarks } from "./gaze";
import type { GazePoint, GazeSample } from "./gaze";
import { scheduleFor } from "./tasks";
import type { CaptureSchedule } from "./tasks";

export type EyePhase = "idle" | "requesting" | "loading-model" | "running" | "analyzing" | "done" | "error";
export type CalibrationStatus = "none" | "ok" | "failed" | "skipped";

const HEAD_WARNING_WINDOW = 30;
const HEAD_WARNING_FRACTION = 0.2;

export function useEyeTracking() {
  const [phase, setPhase] = useState<EyePhase>("idle");
  const [task, setTask] = useState<EyeTaskId | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  const [calibration, setCalibration] = useState<GazeCalibration | null>(null);
  const [calibrationStatus, setCalibrationStatus] = useState<CalibrationStatus>("none");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [target, setTarget] = useState<GazePoint | null>(null);
  const [faceDetected, setFaceDetected] = useState(false);
  const [headMoving, setHeadMoving] = useState(false);
  const [results, setResults] = useState<EyeTaskResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const detector = useRef<FaceLandmarkDetector | null>(null);
  const active = useRef<AbortController | null>(null);
  const calibrationRef = useRef<GazeCalibration | null>(null);
  const frameId = useRef(0);
  const mounted = useRef(true);
  // Canvas and sampling share the exact clock without React updates per frame.
  const timelineRef = useRef<{ readonly schedule: CaptureSchedule; readonly startedAt: number } | null>(null);

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
    setCalibrating(false);
    setTarget(null);
    setElapsedMs(0);
    setFaceDetected(false);
    setHeadMoving(false);
    setError(null);
  }, [release]);

  const storeCalibration = useCallback((value: GazeCalibration | null, status: CalibrationStatus) => {
    calibrationRef.current = value;
    setCalibration(value);
    setCalibrationStatus(status);
    setResults([]);
  }, []);

  const reset = useCallback(() => { cancel(); storeCalibration(null, "none"); }, [cancel, storeCalibration]);

  const skipCalibration = useCallback(() => storeCalibration(null, "skipped"), [storeCalibration]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; release(); };
  }, [release]);

  const capture = useCallback(async (schedule: CaptureSchedule): Promise<GazeSample[]> => {
    if (active.current) throw new DOMException("An eye task is already running.", "InvalidStateError");
    const operation = new AbortController();
    active.current = operation;
    const { signal } = operation;
    const headRef = calibrationRef.current?.headPoseRef ?? null;
    setError(null);
    setElapsedMs(0);
    setTarget(null);
    setFaceDetected(false);
    setHeadMoving(false);
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
      const recentHeadGated: boolean[] = [];
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
              const head = frame?.headPose ?? null;
              samples.push({ t: elapsed, ...gaze, valid: detected, head });
              if (headRef && detected) {
                recentHeadGated.push(head !== null && headPoseDeviationDeg(head, headRef) > HEAD_POSE_TOLERANCE_DEG);
                if (recentHeadGated.length > HEAD_WARNING_WINDOW) recentHeadGated.shift();
              }
              lastSample = now;
            }
            if (now - lastUi >= 100) {
              setElapsedMs(elapsed);
              setTarget(schedule.targetAt(elapsed));
              setFaceDetected(detected);
              setHeadMoving(recentHeadGated.length > 0 &&
                recentHeadGated.filter(Boolean).length / recentHeadGated.length > HEAD_WARNING_FRACTION);
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
      return samples;
    } catch (raised: unknown) {
      if (!signal.aborted && mounted.current) {
        release();
        setError(raised instanceof FaceLandmarkerUnavailableError
          ? "The local face model could not load. Run bun run models:fetch, then retry. No video was uploaded."
          : toMessage(raised));
        setTarget(null);
        setFaceDetected(false);
        setHeadMoving(false);
        setPhase("error");
      }
      throw raised;
    } finally {
      if (active.current === operation) active.current = null;
    }
  }, [release]);

  const finish = useCallback((durationMs: number) => {
    setElapsedMs(durationMs);
    setTarget(null);
    setHeadMoving(false);
    setPhase("done");
  }, []);

  const runTask = useCallback(async (id: EyeTaskId): Promise<EyeTaskResult> => {
    if (active.current) throw new DOMException("An eye task is already running.", "InvalidStateError");
    setTask(id);
    setCalibrating(false);
    const schedule = scheduleFor(id);
    const samples = await capture(schedule);
    const result = analyzeEyeTask(schedule, samples, calibrationRef.current);
    setResults(previous => [...previous.filter(value => value.task !== id), result]);
    finish(schedule.durationMs);
    return result;
  }, [capture, finish]);

  const runCalibration = useCallback(async (): Promise<GazeCalibration | null> => {
    if (active.current) throw new DOMException("An eye task is already running.", "InvalidStateError");
    setTask(null);
    setCalibrating(true);
    const schedule = calibrationSchedule();
    try {
      const samples = await capture(schedule);
      const fitted = fitCalibration(samples);
      storeCalibration(fitted, fitted ? "ok" : "failed");
      finish(schedule.durationMs);
      return fitted;
    } finally {
      setCalibrating(false);
    }
  }, [capture, finish, storeCalibration]);

  return {
    phase, task, calibrating, calibration, calibrationStatus, elapsedMs, target, faceDetected, headMoving,
    results, error, videoRef, timelineRef, runTask, runCalibration, skipCalibration, cancel, reset,
  };
}
