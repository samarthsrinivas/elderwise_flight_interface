import { describe, expect, it } from "vitest";
import type { GazeSample } from "./gaze";
import { blinkRatePerMin, detectSaccades, fixationStability, pursuitGain, saccadeAccuracy, saccadeLatencies, trackingCoverage, velocity } from "./metrics";

function trace(duration: number, xAt: (time: number) => number): GazeSample[] {
  return Array.from({ length: Math.round(duration * 0.06) + 1 }, (_, index) => {
    const t = index * 1000 / 60;
    return { t, x: xAt(t), y: 0.5, valid: true, blink: false };
  });
}

const jump = { tMs: 1000, from: { x: 0.2, y: 0.5 }, to: { x: 0.8, y: 0.5 } };
const ramp = (time: number) => 0.2 + 0.6 * Math.max(0, Math.min(1, (time - 1180) / 40));

describe("eye metrics", () => {
  it("finds one full-amplitude saccade when a delayed 40 ms ramp follows a step", () => {
    const samples = trace(2500, ramp);
    const saccades = detectSaccades(samples);
    expect(saccades).toHaveLength(1);
    expect(saccades[0]?.amplitude).toBeCloseTo(0.6, 2);
  });
  it("measures 180 ms latency when a rightward ramp follows the rightward target", () => {
    const saccades = detectSaccades(trace(2500, ramp));
    const latencies = saccadeLatencies(saccades, [jump]);
    expect(latencies).toHaveLength(1);
    expect(Math.abs((latencies[0] ?? 0) - 180)).toBeLessThanOrEqual(20);
  });
  it("ignores the first response when it moves in the wrong direction", () => {
    const saccades = detectSaccades(trace(2500, time => 1 - ramp(time)));
    const latencies = saccadeLatencies(saccades, [jump]);
    expect(latencies).toEqual([]);
  });
  it("measures unit accuracy when the target is reached by settling time", () => {
    const samples = trace(2500, ramp);
    const accuracy = saccadeAccuracy(samples, [jump]);
    expect(accuracy).toBeCloseTo(1);
  });
  it("returns null accuracy when settling time is unobserved", () => {
    const samples = trace(1200, ramp);
    const accuracy = saccadeAccuracy(samples, [jump]);
    expect(accuracy).toBeNull();
  });
  it("measures Gaussian fixation dispersion without saccades when sigma is 0.01", () => {
    let seed = 71;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed + 1) / 4294967297; };
    const samples = trace(10000, () => 0.5).map(sample => {
      const radius = 0.01 * Math.sqrt(-2 * Math.log(random()));
      const angle = 2 * Math.PI * random();
      return { ...sample, x: 0.5 + radius * Math.cos(angle), y: 0.5 + radius * Math.sin(angle) };
    });
    const result = { stability: fixationStability(samples), saccades: detectSaccades(samples) };
    expect(Math.abs((result.stability ?? 0) - 0.014)).toBeLessThan(0.005);
    expect(result.saccades).toHaveLength(0);
  });
  it("measures 0.9 horizontal gain when gaze follows a scaled sinusoid", () => {
    const target = (t: number) => ({ x: 0.5 + 0.3 * Math.sin(2 * Math.PI * 0.25 * t / 1000), y: 0.5 });
    const samples = trace(15000, t => 0.5 + 0.9 * (target(t).x - 0.5));
    const gain = pursuitGain(samples, target);
    expect(gain).toBeCloseTo(0.9, 2);
  });
  it("counts only 50-500 ms complete blink episodes when observing ten seconds", () => {
    const samples = trace(10000, () => 0.5).map(sample => ({ ...sample, blink:
      (sample.t >= 1000 && sample.t < 1100) || (sample.t >= 3000 && sample.t < 3200) ||
      (sample.t >= 5000 && sample.t < 5010) || (sample.t >= 7000 && sample.t < 7600) }));
    const rate = blinkRatePerMin(samples);
    expect(rate).toBeCloseTo(12);
  });
  it("does not bridge invalid frames when differentiating", () => {
    const samples = trace(100, t => t / 1000).map((sample, index) => ({ ...sample, valid: index !== 3 }));
    const speeds = velocity(samples);
    expect(Number.isNaN(speeds[2])).toBe(true);
    expect(Number.isNaN(speeds[3])).toBe(true);
    expect(Number.isNaN(speeds[4])).toBe(true);
    expect(speeds[1]).toBeCloseTo(1);
  });
  it("returns unavailable metrics when samples are empty", () => {
    const samples: GazeSample[] = [];
    const result = { coverage: trackingCoverage(samples), blink: blinkRatePerMin(samples), stability: fixationStability(samples) };
    expect(result).toEqual({ coverage: 0, blink: null, stability: null });
  });
  it("does not invent a saccade across a tracking gap", () => {
    const samples = trace(2500, ramp).map(sample => ({ ...sample, valid: sample.t < 1150 || sample.t > 1250 }));
    const events = detectSaccades(samples);
    expect(events).toEqual([]);
  });
  it("censors a blink when tracking disappears before reopening", () => {
    const samples = trace(1000, () => 0.5).map(sample => ({ ...sample,
      blink: sample.t >= 200 && sample.t < 400, valid: sample.t < 300 || sample.t >= 400 }));
    const rate = blinkRatePerMin(samples);
    expect(rate).toBe(0);
  });
  it("returns null gain when the target never moves", () => {
    const samples = trace(1000, () => 0.5);
    const gain = pursuitGain(samples, () => ({ x: 0.5, y: 0.5 }));
    expect(gain).toBeNull();
  });
});
