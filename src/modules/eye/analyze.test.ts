import { describe, expect, it } from "vitest";
import type { GazeCalibration } from "../assessment/types";
import { eyeResultSchema, eyeTaskResultSchema } from "../assessment/types";
import { aggregateEyeResults, analyzeEyeTask } from "./analyze";
import type { GazeSample } from "./gaze";
import { EYE_TASK_ORDER, scheduleFor } from "./tasks";
import type { TargetSchedule } from "./tasks";

const identity: GazeCalibration = {
  ax: 0, bx: 1, ay: 0, by: 1, residualX: 0.004, residualY: 0.004, pointsUsed: 5, headPoseRef: null,
};

function healthyTasks() {
  return EYE_TASK_ORDER.map(task => ({ ...analyzeEyeTask(scheduleFor(task), [], identity),
    trackingCoverage: 1, fixationStability: task === "fixation" ? 0.01 : null,
    meanSaccadeLatencyMs: task === "prosaccade" ? 180 : null,
    saccadeAccuracy: task === "prosaccade" ? 0.9 : null,
    pursuitGain: task === "smooth-pursuit" ? 0.9 : null }));
}

function trackingSamples(schedule: TargetSchedule, hz = 60, noise = (_t: number) => 0): GazeSample[] {
  return Array.from({ length: Math.ceil(schedule.durationMs * hz / 1000) }, (_, index) => {
    const t = index * 1000 / hz;
    const target = schedule.targetAt(t);
    return { t, x: target.x + noise(t), y: target.y + noise(t + 7), valid: true, blink: false };
  });
}

function seededGaussian(seed: number, sigma: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return (state + 0.5) / 2 ** 32;
  };
  return () => sigma * Math.sqrt(-2 * Math.log(next())) * Math.cos(2 * Math.PI * next());
}

describe("eye analysis", () => {
  it.each(EYE_TASK_ORDER)("produces schema-valid results when %s tracks the target", task => {
    const schedule = scheduleFor(task);
    const samples = trackingSamples(schedule);
    const result = analyzeEyeTask(schedule, samples);
    expect(eyeTaskResultSchema.parse(result)).toEqual(result);
    expect(result.trackingCoverage).toBe(1);
    expect(result.sampleCount).toBe(samples.length);
    expect(result.gazeUnits).toBe("proxy");
    expect(result.targetErrorRms).toBeNull();
  });
  it.each(EYE_TASK_ORDER)("returns null metrics when %s has no samples", task => {
    const schedule = scheduleFor(task);
    const result = analyzeEyeTask(schedule, []);
    expect(eyeTaskResultSchema.parse(result)).toMatchObject({ trackingCoverage: 0, sampleCount: 0,
      saccadeCount: 0, fixationStability: null, meanSaccadeLatencyMs: null,
      meanSaccadePeakVelocity: null, saccadeAccuracy: null, pursuitGain: null, blinkRatePerMin: null,
      gazeUnits: "proxy", targetErrorRms: null, headMotionDeg: null });
  });
  it("reports pursuit gain near 1 when calibrated gaze follows the target exactly", () => {
    const schedule = scheduleFor("smooth-pursuit");
    const result = analyzeEyeTask(schedule, trackingSamples(schedule), identity);
    expect(result.gazeUnits).toBe("screen");
    expect(result.pursuitGain).toBeCloseTo(1, 2);
    expect(result.targetErrorRms).toBeCloseTo(0, 6);
  });
  it("over-reads pursuit gain without calibration because auto-scaling stretches the gaze span", () => {
    const schedule = scheduleFor("smooth-pursuit");
    const result = analyzeEyeTask(schedule, trackingSamples(schedule));
    expect(result.pursuitGain).toBeGreaterThan(1.4);
  });
  it("keeps calibrated fixation stability below the screen threshold for small gaze noise", () => {
    const schedule = scheduleFor("fixation");
    const noise = seededGaussian(42, 0.005);
    const result = analyzeEyeTask(schedule, trackingSamples(schedule, 30, () => noise()), identity);
    expect(result.fixationStability).not.toBeNull();
    expect(result.fixationStability as number).toBeLessThan(0.03);
    expect(result.targetErrorRms as number).toBeLessThan(0.03);
  });
  it("cannot produce a usable uncalibrated fixation stability for the same gaze noise", () => {
    const schedule = scheduleFor("fixation");
    const noise = seededGaussian(42, 0.005);
    const result = analyzeEyeTask(schedule, trackingSamples(schedule, 30, () => noise()));
    expect(result.fixationStability ?? Infinity).toBeGreaterThan(0.05);
  });
  it("marks samples whose head pose drifts from the calibration reference as untracked", () => {
    const schedule = scheduleFor("fixation");
    const withRef = { ...identity, headPoseRef: { yawDeg: 0, pitchDeg: 0 } };
    const samples = trackingSamples(schedule, 30).map((sample, index) => ({
      ...sample,
      head: { yawDeg: index % 2 ? 25 : 0, pitchDeg: 0, rollDeg: 0 },
    }));
    const result = analyzeEyeTask(schedule, samples, withRef);
    expect(result.trackingCoverage).toBeCloseTo(0.5, 1);
    expect(result.headMotionDeg).toBeCloseTo(25 / Math.SQRT2, 1);
  });
  it("returns good when all four heuristic measures pass", () => {
    const tasks = healthyTasks();
    const result = aggregateEyeResults(tasks, identity);
    expect(eyeResultSchema.parse(result)).toMatchObject({ quality: "good", band: "good", calibration: identity });
  });
  it("returns moderate when only latency misses its threshold", () => {
    const tasks = healthyTasks().map(task => task.task === "prosaccade" ? { ...task, meanSaccadeLatencyMs: 300 } : task);
    const result = aggregateEyeResults(tasks, identity);
    expect(result.band).toBe("moderate");
  });
  it("returns limited when two measures miss their thresholds", () => {
    const tasks = healthyTasks().map(task => task.task === "prosaccade" ? { ...task, meanSaccadeLatencyMs: 400, saccadeAccuracy: 0.5 } : task);
    const result = aggregateEyeResults(tasks, identity);
    expect(result.band).toBe("limited");
  });
  it("fails calibrated fixation at the tighter screen threshold", () => {
    const tasks = healthyTasks().map(task => task.task === "fixation" ? { ...task, fixationStability: 0.04 } : task);
    expect(aggregateEyeResults(tasks, identity).band).toBe("moderate");
  });
  it("caps uncalibrated results at moderate and ignores auto-scaled stability and gain", () => {
    const tasks = healthyTasks().map(task => ({ ...task, gazeUnits: "proxy" as const, fixationStability: task.task === "fixation" ? 0.4 : null, pursuitGain: task.task === "smooth-pursuit" ? 1.5 : null }));
    const result = aggregateEyeResults(tasks);
    expect(result.band).toBe("moderate");
    expect(result.calibration).toBeNull();
  });
  it("still returns limited for uncalibrated results when latency and accuracy both fail", () => {
    const tasks = healthyTasks().map(task => ({ ...task, gazeUnits: "proxy" as const,
      ...(task.task === "prosaccade" ? { meanSaccadeLatencyMs: 400, saccadeAccuracy: 0.5 } : {}) }));
    expect(aggregateEyeResults(tasks).band).toBe("limited");
  });
  it("treats a mix of calibrated and uncalibrated tasks as uncalibrated", () => {
    const tasks = healthyTasks().map(task => task.task === "fixation" ? { ...task, gazeUnits: "proxy" as const } : task);
    const result = aggregateEyeResults(tasks, identity);
    expect(result.band).toBe("moderate");
    expect(result.calibration).toBeNull();
  });
  it.each([[0.85, "good"], [0.6, "fair"], [0.59, "poor"]] as const)("assigns quality %s when minimum coverage crosses the threshold", (coverage, quality) => {
    const tasks = healthyTasks().map(task => ({ ...task, trackingCoverage: coverage }));
    const result = aggregateEyeResults(tasks, identity);
    expect(result.quality).toBe(quality);
    if (quality === "poor") expect(result.band).toBe("limited");
  });
  it("returns unavailable and limited when no tasks exist", () => {
    const result = aggregateEyeResults([]);
    expect(eyeResultSchema.parse(result)).toEqual({ tasks: [], quality: "unavailable", band: "limited", calibration: null });
  });
});
