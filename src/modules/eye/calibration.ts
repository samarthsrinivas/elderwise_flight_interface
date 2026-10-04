import { headPoseDeviationDeg } from "../../lib/headPose";
import type { GazeCalibration } from "../assessment/types";
import { usable } from "./gaze";
import type { GazePoint, GazeSample } from "./gaze";
import type { CaptureSchedule } from "./tasks";

export const CALIBRATION_POINTS: readonly GazePoint[] = [
  { x: 0.5, y: 0.5 },
  { x: 0.2, y: 0.5 },
  { x: 0.8, y: 0.5 },
  { x: 0.5, y: 0.25 },
  { x: 0.5, y: 0.75 },
];
export const CALIBRATION_DWELL_MS = 2000;
export const CALIBRATION_SETTLE_MS = 700;
export const CALIBRATION_MIN_SAMPLES_PER_POINT = 12;
export const CALIBRATION_MIN_POINTS = 4;
export const CALIBRATION_MAX_RESIDUAL = 0.06;
export const HEAD_POSE_TOLERANCE_DEG = 10;

const CALIBRATED_RANGE = { min: -0.2, max: 1.2 } as const;

export function calibrationSchedule(): CaptureSchedule {
  const last = CALIBRATION_POINTS.length - 1;
  return {
    durationMs: CALIBRATION_DWELL_MS * CALIBRATION_POINTS.length,
    targetAt: tMs => CALIBRATION_POINTS[Math.min(last, Math.max(0, Math.floor(tMs / CALIBRATION_DWELL_MS)))],
    instructions: "Look at each dot as it appears. Keep your head still.",
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

interface DotObservation {
  readonly target: GazePoint;
  readonly proxy: GazePoint;
}

function observeDots(samples: readonly GazeSample[]): DotObservation[] {
  const observations: DotObservation[] = [];
  CALIBRATION_POINTS.forEach((target, index) => {
    const onset = index * CALIBRATION_DWELL_MS;
    const window = samples.filter(
      sample => usable(sample) && sample.t >= onset + CALIBRATION_SETTLE_MS && sample.t < onset + CALIBRATION_DWELL_MS,
    );
    if (window.length < CALIBRATION_MIN_SAMPLES_PER_POINT) return;
    observations.push({
      target,
      proxy: { x: median(window.map(sample => sample.x)), y: median(window.map(sample => sample.y)) },
    });
  });
  return observations;
}

interface AxisFit {
  readonly a: number;
  readonly b: number;
  readonly residual: number;
}

function fitAxis(pairs: ReadonlyArray<readonly [proxy: number, screen: number]>): AxisFit | null {
  const targets = new Set(pairs.map(([, screen]) => screen));
  if (targets.size < 2) return null;
  const n = pairs.length;
  const meanProxy = pairs.reduce((sum, [proxy]) => sum + proxy, 0) / n;
  const meanScreen = pairs.reduce((sum, [, screen]) => sum + screen, 0) / n;
  let covariance = 0;
  let variance = 0;
  for (const [proxy, screen] of pairs) {
    covariance += (proxy - meanProxy) * (screen - meanScreen);
    variance += (proxy - meanProxy) ** 2;
  }
  if (variance <= 0) return null;
  const b = covariance / variance;
  const a = meanScreen - b * meanProxy;
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return null;
  const residual = Math.sqrt(pairs.reduce((sum, [proxy, screen]) => sum + (a + b * proxy - screen) ** 2, 0) / n);
  return residual <= CALIBRATION_MAX_RESIDUAL ? { a, b, residual } : null;
}

function headPoseReference(samples: readonly GazeSample[]): GazeCalibration["headPoseRef"] {
  const poses = samples.flatMap(sample => (usable(sample) && sample.head ? [sample.head] : []));
  if (poses.length === 0) return null;
  return { yawDeg: median(poses.map(pose => pose.yawDeg)), pitchDeg: median(poses.map(pose => pose.pitchDeg)) };
}

export function fitCalibration(samples: readonly GazeSample[]): GazeCalibration | null {
  const dots = observeDots(samples);
  if (dots.length < CALIBRATION_MIN_POINTS) return null;
  const xFit = fitAxis(dots.map(dot => [dot.proxy.x, dot.target.x] as const));
  const yFit = fitAxis(dots.map(dot => [dot.proxy.y, dot.target.y] as const));
  if (!xFit || !yFit) return null;
  return {
    ax: xFit.a,
    bx: xFit.b,
    ay: yFit.a,
    by: yFit.b,
    residualX: xFit.residual,
    residualY: yFit.residual,
    pointsUsed: dots.length,
    headPoseRef: headPoseReference(samples),
  };
}

const clampCalibrated = (value: number) => Math.max(CALIBRATED_RANGE.min, Math.min(CALIBRATED_RANGE.max, value));

export function applyCalibration(samples: readonly GazeSample[], calibration: GazeCalibration): GazeSample[] {
  return samples.map(sample =>
    usable(sample)
      ? {
          ...sample,
          x: clampCalibrated(calibration.ax + calibration.bx * sample.x),
          y: clampCalibrated(calibration.ay + calibration.by * sample.y),
        }
      : { ...sample },
  );
}

export function gateHeadPose(
  samples: readonly GazeSample[],
  reference: NonNullable<GazeCalibration["headPoseRef"]>,
): GazeSample[] {
  return samples.map(sample =>
    sample.head && headPoseDeviationDeg(sample.head, reference) > HEAD_POSE_TOLERANCE_DEG
      ? { ...sample, valid: false }
      : { ...sample },
  );
}

export function headMotionDeg(
  samples: readonly GazeSample[],
  reference: NonNullable<GazeCalibration["headPoseRef"]>,
): number | null {
  const deviations = samples.flatMap(sample => (sample.head ? [headPoseDeviationDeg(sample.head, reference)] : []));
  if (deviations.length === 0) return null;
  return Math.sqrt(deviations.reduce((sum, value) => sum + value * value, 0) / deviations.length);
}
