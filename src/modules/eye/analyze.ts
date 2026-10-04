import type { EyeResult, EyeTaskResult } from "../assessment/types";
import { normaliseGaze } from "./gaze";
import type { GazeSample } from "./gaze";
import { blinkRatePerMin, detectSaccades, fixationStability, pursuitGain,
  saccadeAccuracy, saccadeLatencies, trackingCoverage } from "./metrics";
import { assertNever } from "./tasks";
import type { TargetSchedule } from "./tasks";

const mean = (values: readonly number[]): number | null =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

export function analyzeEyeTask(schedule: TargetSchedule, samples: readonly GazeSample[]): EyeTaskResult {
  const normalized = normaliseGaze(samples);
  const saccades = detectSaccades(normalized);
  const base: EyeTaskResult = { task: schedule.task, durationS: schedule.durationMs / 1000,
    sampleCount: samples.length, trackingCoverage: trackingCoverage(samples),
    fixationStability: null, saccadeCount: saccades.length, meanSaccadeLatencyMs: null,
    meanSaccadePeakVelocity: null, saccadeAccuracy: null, pursuitGain: null, blinkRatePerMin: null };
  switch (schedule.task) {
    case "fixation": return { ...base, fixationStability: fixationStability(normalized), blinkRatePerMin: blinkRatePerMin(samples) };
    case "prosaccade": return { ...base,
      meanSaccadeLatencyMs: mean(saccadeLatencies(saccades, schedule.jumps)),
      meanSaccadePeakVelocity: mean(saccades.map(event => event.peakVelocity)),
      saccadeAccuracy: saccadeAccuracy(normalized, schedule.jumps) };
    case "smooth-pursuit": return { ...base, pursuitGain: pursuitGain(normalized, schedule.targetAt), blinkRatePerMin: blinkRatePerMin(samples) };
    default: return assertNever(schedule.task);
  }
}

/** Exploratory, non-diagnostic heuristic: latency <300 ms, accuracy >=0.7,
 * gain 0.7-1.2, stability <0.05. One failed/missing metric = moderate;
 * two or more, poor quality, or no data = limited. Missing is never reassuring. */
export function aggregateEyeResults(tasks: EyeTaskResult[]): EyeResult {
  if (tasks.length === 0) return { tasks: [], quality: "unavailable", band: "limited" };
  const coverage = Math.min(...tasks.map(task => task.trackingCoverage));
  const quality = coverage >= 0.85 ? "good" : coverage >= 0.6 ? "fair" : "poor";
  const fixation = tasks.find(task => task.task === "fixation")?.fixationStability;
  const latency = tasks.find(task => task.task === "prosaccade")?.meanSaccadeLatencyMs;
  const accuracy = tasks.find(task => task.task === "prosaccade")?.saccadeAccuracy;
  const gain = tasks.find(task => task.task === "smooth-pursuit")?.pursuitGain;
  const passes = [fixation != null && fixation < 0.05, latency != null && latency < 300,
    accuracy != null && accuracy >= 0.7, gain != null && gain >= 0.7 && gain <= 1.2];
  const failures = passes.filter(pass => !pass).length;
  return { tasks, quality, band: quality === "poor" || failures >= 2 ? "limited" : failures === 1 ? "moderate" : "good" };
}
