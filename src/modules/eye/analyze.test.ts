import { describe, expect, it } from "vitest";
import { eyeResultSchema, eyeTaskResultSchema } from "../assessment/types";
import { aggregateEyeResults, analyzeEyeTask } from "./analyze";
import { EYE_TASK_ORDER, scheduleFor } from "./tasks";

function healthyTasks() {
  return EYE_TASK_ORDER.map(task => ({ ...analyzeEyeTask(scheduleFor(task), []),
    trackingCoverage: 1, fixationStability: task === "fixation" ? 0.01 : null,
    meanSaccadeLatencyMs: task === "prosaccade" ? 180 : null,
    saccadeAccuracy: task === "prosaccade" ? 0.9 : null,
    pursuitGain: task === "smooth-pursuit" ? 0.9 : null }));
}

describe("eye analysis", () => {
  it.each(EYE_TASK_ORDER)("produces schema-valid results when %s tracks the target", task => {
    const schedule = scheduleFor(task);
    const samples = Array.from({ length: Math.ceil(schedule.durationMs * 0.06) }, (_, index) => {
      const t = index * 1000 / 60;
      return { t, ...schedule.targetAt(t), valid: true, blink: false };
    });
    const result = analyzeEyeTask(schedule, samples);
    expect(eyeTaskResultSchema.parse(result)).toEqual(result);
    expect(result.trackingCoverage).toBe(1);
    expect(result.sampleCount).toBe(samples.length);
  });
  it.each(EYE_TASK_ORDER)("returns null metrics when %s has no samples", task => {
    const schedule = scheduleFor(task);
    const result = analyzeEyeTask(schedule, []);
    expect(eyeTaskResultSchema.parse(result)).toMatchObject({ trackingCoverage: 0, sampleCount: 0,
      saccadeCount: 0, fixationStability: null, meanSaccadeLatencyMs: null,
      meanSaccadePeakVelocity: null, saccadeAccuracy: null, pursuitGain: null, blinkRatePerMin: null });
  });
  it("returns good when all four heuristic measures pass", () => {
    const tasks = healthyTasks();
    const result = aggregateEyeResults(tasks);
    expect(eyeResultSchema.parse(result)).toMatchObject({ quality: "good", band: "good" });
  });
  it("returns moderate when only latency misses its threshold", () => {
    const tasks = healthyTasks().map(task => task.task === "prosaccade" ? { ...task, meanSaccadeLatencyMs: 300 } : task);
    const result = aggregateEyeResults(tasks);
    expect(result.band).toBe("moderate");
  });
  it("returns limited when two measures miss their thresholds", () => {
    const tasks = healthyTasks().map(task => task.task === "prosaccade" ? { ...task, meanSaccadeLatencyMs: 400, saccadeAccuracy: 0.5 } : task);
    const result = aggregateEyeResults(tasks);
    expect(result.band).toBe("limited");
  });
  it.each([[0.85, "good"], [0.6, "fair"], [0.59, "poor"]] as const)("assigns quality %s when minimum coverage crosses the threshold", (coverage, quality) => {
    const tasks = healthyTasks().map(task => ({ ...task, trackingCoverage: coverage }));
    const result = aggregateEyeResults(tasks);
    expect(result.quality).toBe(quality);
    if (quality === "poor") expect(result.band).toBe("limited");
  });
  it("returns unavailable and limited when no tasks exist", () => {
    const result = aggregateEyeResults([]);
    expect(eyeResultSchema.parse(result)).toEqual({ tasks: [], quality: "unavailable", band: "limited" });
  });
});
