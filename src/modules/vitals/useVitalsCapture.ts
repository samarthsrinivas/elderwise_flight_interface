import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { FaceLandmarkerUnavailableError, loadFaceLandmarkDetector } from "../../lib/faceLandmarker";
import type { FaceLandmarkDetector } from "../../lib/faceLandmarker";
import { toMessage } from "../../lib/errors";
import type { VitalsResult } from "../assessment/types";
import { cheekRois, foreheadRoi, meanRgb } from "./faceRoi";
import { analyzeRppg, bandpass, detrend, estimateHeartRate, posSignal, resampleUniform } from "./rppg";
import type { RgbSample } from "./rppg";

export type VitalsPhase = "idle" | "requesting" | "loading-model" | "capturing" | "analyzing" | "done" | "error";
export interface VitalsCaptureState {
  readonly phase: VitalsPhase;
  readonly progress: number;
  readonly elapsedS: number;
  readonly liveBpm: number | null;
  readonly faceDetected: boolean;
  readonly result: VitalsResult | null;
  readonly error: string | null;
}
export interface VitalsCaptureController extends VitalsCaptureState {
  readonly videoRef: RefObject<HTMLVideoElement | null>;
  start(): Promise<void>;
  cancel(): void;
}

const initialState: VitalsCaptureState = {
  phase: "idle", progress: 0, elapsedS: 0, liveBpm: null,
  faceDetected: false, result: null, error: null,
};

export function useVitalsCapture(opts?: { readonly durationS?: number }): VitalsCaptureController {
  const requestedDuration = opts?.durationS ?? 30;
  const durationS = Number.isFinite(requestedDuration) && requestedDuration > 0 ? Math.min(requestedDuration, 120) : 30;
  const [state, setState] = useState(initialState);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<FaceLandmarkDetector | null>(null);
  const frameRef = useRef<number | null>(null);
  const sessionRef = useRef<AbortController | null>(null);

  const release = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    detectorRef.current?.close();
    detectorRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const stop = useCallback(() => {
    sessionRef.current?.abort();
    sessionRef.current = null;
    release();
  }, [release]);

  const cancel = useCallback(() => {
    stop();
    setState(initialState);
  }, [stop]);

  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    stop();
    const session = new AbortController();
    sessionRef.current = session;
    setState({ ...initialState, phase: "requesting" });
    const fail = (error: unknown) => {
      if (session.signal.aborted) return;
      const message = error instanceof FaceLandmarkerUnavailableError ? error.message
        : error instanceof Error && error.name === "NotAllowedError"
          ? "Camera permission was denied. Please allow camera access and try again."
          : toMessage(error);
      stop();
      setState(previous => ({ ...previous, phase: "error", faceDetected: false, liveBpm: null, error: message }));
    };
    if (typeof document === "undefined" || typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      fail("Camera access is unavailable in this environment.");
      return;
    }
    const video = videoRef.current;
    if (!video) { fail("The camera preview is not ready. Please try again."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 640, height: 480, frameRate: 30 }, audio: false });
      if (session.signal.aborted) { stream.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = stream;
      stream.getVideoTracks().forEach(track => track.addEventListener("ended", () => fail("The camera disconnected. Please reconnect it and try again."), { signal: session.signal }));
      video.srcObject = stream;
      await video.play();
      if (session.signal.aborted) return;
      setState(previous => ({ ...previous, phase: "loading-model" }));
      const detector = await loadFaceLandmarkDetector();
      if (session.signal.aborted) { detector.close(); return; }
      detectorRef.current = detector;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) { fail("This device cannot read camera frames."); return; }
      const samples: RgbSample[] = [];
      const started = performance.now();
      let totalFrames = 0;
      let faceFrames = 0;
      let previousFrame = -1;
      let lastLive = 6;
      setState(previous => ({ ...previous, phase: "capturing" }));
      const tick = (timestamp: number) => {
        if (session.signal.aborted) return;
        try {
          const elapsedS = Math.min(durationS, (timestamp - started) / 1000);
          if (elapsedS >= durationS) {
            release();
            setState(previous => ({ ...previous, phase: "analyzing", progress: 1, elapsedS, faceDetected: false }));
            frameRef.current = requestAnimationFrame(() => {
              if (session.signal.aborted) return;
              const result = analyzeRppg(samples, { durationS: elapsedS, faceCoverage: totalFrames > 0 ? faceFrames / totalFrames : 0 });
              stop();
              setState(previous => ({ ...previous, phase: "done", liveBpm: null, result }));
            });
            return;
          }
          const decodedFrame = typeof video.getVideoPlaybackQuality === "function"
            ? video.getVideoPlaybackQuality().totalVideoFrames : video.currentTime;
          if (video.readyState >= 2 && decodedFrame !== previousFrame) {
            previousFrame = decodedFrame;
            totalFrames++;
            const face = detector.detect(video, timestamp);
            if (face) {
              faceFrames++;
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              let rgb = meanRgb(ctx, foreheadRoi(face.landmarks, canvas.width, canvas.height));
              if (rgb === null) {
                const cheeks = cheekRois(face.landmarks, canvas.width, canvas.height).flatMap(roi => {
                  const color = meanRgb(ctx, roi);
                  return color ? [color] : [];
                });
                if (cheeks.length > 0) rgb = cheeks.reduce((sum, color) => ({ r: sum.r + color.r / cheeks.length, g: sum.g + color.g / cheeks.length, b: sum.b + color.b / cheeks.length }), { r: 0, g: 0, b: 0 });
              }
              if (rgb) samples.push({ t: timestamp, ...rgb });
            }
            setState(previous => ({ ...previous, faceDetected: face !== null, elapsedS, progress: elapsedS / durationS, liveBpm: face ? previous.liveBpm : null }));
          }
          if (elapsedS >= 8 && elapsedS - lastLive >= 2) {
            lastLive = elapsedS;
            const recent = samples.filter(sample => sample.t >= timestamp - 12000);
            let liveBpm: number | null = null;
            if (recent.length >= 60 && recent[recent.length - 1].t > timestamp - 500) {
              const spanS = (recent[recent.length - 1].t - recent[0].t) / 1000;
              const fs = Math.min(30, (recent.length - 1) / spanS);
              if (spanS >= 7.5 && fs > 6) {
                const uniform = resampleUniform(recent, fs);
                const estimate = estimateHeartRate(bandpass(detrend(posSignal(uniform, fs), Math.round(fs * 1.5)), fs, 0.7, 3), fs);
                if (estimate.snr !== null && estimate.snr >= 0) liveBpm = estimate.bpm;
              }
            }
            setState(previous => ({ ...previous, liveBpm }));
          }
          frameRef.current = requestAnimationFrame(tick);
        } catch (error: unknown) { fail(error); }
      };
      frameRef.current = requestAnimationFrame(tick);
    } catch (error: unknown) { fail(error); }
  }, [durationS, release, stop]);

  return { ...state, videoRef, start, cancel };
}
