import type { EyeResult, EyeTaskResult, GazeCalibration } from "../assessment/types";
import { applyCalibration, gateHeadPose, headMotionDeg } from "./calibration";
import { normaliseGaze } from "./gaze";
import type { GazeSample } from "./gaze";
import {
  blinkRatePerMin,
  detectSaccades,
  fixationStability,
  pursuitGain,
  saccadeAccuracy,
  saccadeLatencies,
  targetErrorRms,
  trackingCoverage,
} from "./metrics";
import { assertNever } from "./tasks";
import type { TargetSchedule } from "./tasks";

const mean = (values: readonly number[]): number | null =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

export function analyzeEyeTask(
  schedule: TargetSchedule,
  samples: readonly GazeSample[],
  calibration: GazeCalibration | null = null,
): EyeTaskResult {
  const headRef = calibration?.headPoseRef ?? null;
  const gated = headRef ? gateHeadPose(samples, headRef) : samples;
  const normalized = calibration ? applyCalibration(gated, calibration) : normaliseGaze(gated);
  const saccades = detectSaccades(normalized);
  const base: EyeTaskResult = {
    task: schedule.task,
    durationS: schedule.durationMs / 1000,
    sampleCount: samples.length,
    trackingCoverage: trackingCoverage(gated),
    fixationStability: null,
    saccadeCount: saccades.length,
    meanSaccadeLatencyMs: null,
    meanSaccadePeakVelocity: null,
    saccadeAccuracy: null,
    pursuitGain: null,
    blinkRatePerMin: null,
    gazeUnits: calibration ? "screen" : "proxy",
    targetErrorRms: calibration ? targetErrorRms(normalized, schedule.targetAt) : null,
    headMotionDeg: headRef ? headMotionDeg(samples, headRef) : null,
  };
  switch (schedule.task) {
    case "fixation":
      return { ...base, fixationStability: fixationStability(normalized), blinkRatePerMin: blinkRatePerMin(gated) };
    case "prosaccade":
      return {
        ...base,
        meanSaccadeLatencyMs: mean(saccadeLatencies(saccades, schedule.jumps)),
        meanSaccadePeakVelocity: mean(saccades.map(event => event.peakVelocity)),
        saccadeAccuracy: saccadeAccuracy(normalized, schedule.jumps),
      };
    case "smooth-pursuit":
      return { ...base, pursuitGain: pursuitGain(normalized, schedule.targetAt), blinkRatePerMin: blinkRatePerMin(gated) };
    default:
      return assertNever(schedule.task);
  }
}

const SCREEN_FIXATION_LIMIT = 0.03;

/** Exploratory, non-diagnostic heuristic. Calibrated (screen units): latency
 * <300 ms, accuracy >=0.7, gain 0.7-1.2, stability <0.03. Uncalibrated (proxy
 * units): stability and gain are auto-scaled so only latency and accuracy are
 * banded, and the band never exceeds moderate. One failed/missing metric =
 * moderate; two or more, poor quality, or no data = limited. */
export function aggregateEyeResults(tasks: EyeTaskResult[], calibration: GazeCalibration | null = null): EyeResult {
  if (tasks.length === 0) return { tasks: [], quality: "unavailable", band: "limited", calibration: null };
  const calibrated = tasks.every(task => task.gazeUnits === "screen");
  const coverage = Math.min(...tasks.map(task => task.trackingCoverage));
  const quality = coverage >= 0.85 ? "good" : coverage >= 0.6 ? "fair" : "poor";
  const fixation = tasks.find(task => task.task === "fixation")?.fixationStability;
  const latency = tasks.find(task => task.task === "prosaccade")?.meanSaccadeLatencyMs;
  const accuracy = tasks.find(task => task.task === "prosaccade")?.saccadeAccuracy;
  const gain = tasks.find(task => task.task === "smooth-pursuit")?.pursuitGain;
  const passes = calibrated
    ? [
        fixation != null && fixation < SCREEN_FIXATION_LIMIT,
        latency != null && latency < 300,
        accuracy != null && accuracy >= 0.7,
        gain != null && gain >= 0.7 && gain <= 1.2,
      ]
    : [latency != null && latency < 300, accuracy != null && accuracy >= 0.7];
  const failures = passes.filter(pass => !pass).length;
  const band = quality === "poor" || failures >= 2 ? "limited" : failures === 1 || !calibrated ? "moderate" : "good";
  return { tasks, quality, band, calibration: calibrated ? calibration : null };
}
