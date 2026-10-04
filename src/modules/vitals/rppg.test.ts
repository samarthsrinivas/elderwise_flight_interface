import { describe, expect, it } from "vitest";
import { vitalsResultSchema } from "../assessment/types";
import {
  analyzeRppg, bandpass, detectPeaks, detrend, estimateHeartRate,
  estimateRespiratoryRate, interBeatIntervalsMs, posSignal, resampleUniform,
  rmssd, sdnn,
} from "./rppg";
import { syntheticRgb, sine } from "./syntheticFixtures";

describe("local rPPG", () => {
  it("recovers heart rate when RGB contains pulse, drift and noise", () => {
    const pulse = bandpass(detrend(posSignal(syntheticRgb(), 30), 45), 30, 0.7, 3);

    const result = estimateHeartRate(pulse, 30);

    expect(result.bpm).not.toBeNull();
    expect(Math.abs((result.bpm ?? 0) - 72)).toBeLessThanOrEqual(3);
    expect(result.snr).toBeGreaterThan(3);
  });

  it.each([[0.1, -20], [1.2, -3]])("filters a %s Hz sine with the expected gain", (hz, limit) => {
    const input = sine(hz);

    const output = bandpass(input, 30, 0.7, 3);

    const energy = (values: Float64Array) => values.slice(150, -150).reduce((sum, value) => sum + value ** 2, 0);
    const gainDb = 10 * Math.log10(energy(output) / energy(input));
    if (hz < 0.7) expect(gainDb).toBeLessThan(limit);
    else expect(Math.abs(gainDb)).toBeLessThan(3);
  });

  it("counts beats when given a 30 second 1.2 Hz pulse", () => {
    const input = sine(1.2);

    const peaks = detectPeaks(input, 30, 0.3);

    expect(peaks).toHaveLength(36);
  });

  it("rejects invalid intervals when converting peaks", () => {
    const peaks = [0, 30, 63, 93, 96, 196, 226];

    const intervals = interBeatIntervalsMs(peaks, 30);

    expect(intervals).toEqual([1000, 1100, 1000, 1000]);
  });

  it("computes exact RMSSD when intervals contain outliers", () => {
    const intervals = [1000, 1100, 1000, 900, 100, 2500, 1600];

    const result = rmssd(intervals);

    expect(result).toBeCloseTo(100, 10);
  });

  it("computes sample SDNN when intervals contain outliers", () => {
    const intervals = [1000, 1100, 1000, 900, 100, 2500, 1600];

    const result = sdnn(intervals);

    expect(result).toBeCloseTo(Math.sqrt(20000 / 3), 10);
  });

  it("returns null HRV when there are too few intervals", () => {
    const intervals = [1000, NaN, 100];

    const result = [rmssd(intervals), sdnn(intervals)];

    expect(result).toEqual([null, null]);
  });

  it("recovers respiration when green contains slow modulation", () => {
    const input = syntheticRgb();

    const result = estimateRespiratoryRate(input, 30);

    expect(result).not.toBeNull();
    expect(Math.abs((result ?? 0) - 15)).toBeLessThanOrEqual(2);
  });

  it("returns null respiration when band power is flat", () => {
    const input = new Float64Array(900).fill(120);

    const result = estimateRespiratoryRate(input, 30);

    expect(result).toBeNull();
  });

  it("interpolates color when frame timestamps are irregular", () => {
    const samples = [{ t: 0, r: 0, g: 10, b: 20 }, { t: 80, r: 80, g: 90, b: 100 }, { t: 200, r: 200, g: 210, b: 220 }];

    const result = resampleUniform(samples, 10);

    expect(result).toEqual([{ t: 0, r: 0, g: 10, b: 20 }, { t: 100, r: 100, g: 110, b: 120 }, { t: 200, r: 200, g: 210, b: 220 }]);
  });

  it("returns schema-valid unavailable results when capture is too short", () => {
    const input = syntheticRgb().slice(0, 240);

    const result = vitalsResultSchema.parse(analyzeRppg(input, { faceCoverage: 1, durationS: 8 }));

    expect(result.quality).toBe("unavailable");
    expect(result.heartRateBpm).toBeNull();
  });

  it("produces a good band when pulse variability and tracking are good", () => {
    const input = syntheticRgb();

    const result = vitalsResultSchema.parse(analyzeRppg(input, { faceCoverage: 0.98, durationS: 30 }));

    expect(result.band).toBe("good");
    expect(result.quality).toBe("good");
    expect(result.hrvRmssdMs).toBeGreaterThanOrEqual(20);
  });

  it.each([[], [{ t: NaN, r: Infinity, g: 0, b: -1 }], syntheticRgb().map(sample => ({ ...sample, t: 0 }))].map(samples => ({ samples })))("degrades safely when timestamps or samples are unusable", ({ samples }) => {
    const input = samples;

    const result = vitalsResultSchema.parse(analyzeRppg(input, { faceCoverage: NaN, durationS: Infinity }));

    expect(result.quality).toBe("unavailable");
    expect(result.faceCoverage).toBe(0);
  });

  it("returns unavailable when a long capture has constant color", () => {
    const input = syntheticRgb().map(sample => ({ ...sample, r: 100, g: 120, b: 80 }));

    const result = analyzeRppg(input, { faceCoverage: 1, durationS: 30 });

    expect(result.quality).toBe("unavailable");
  });

  it("limits the band when face coverage is poor", () => {
    const input = syntheticRgb();

    const result = analyzeRppg(input, { faceCoverage: 0.5, durationS: 30 });

    expect(result.quality).toBe("poor");
    expect(result.band).toBe("limited");
  });

  it("keeps HRV unavailable when fewer than ten valid intervals exist", () => {
    const input = Array.from({ length: 300 }, (_, index) => {
      const pulse = Math.sin(2 * Math.PI * 0.8 * index / 30);
      return { t: index * 1000 / 30, r: 140 + 0.2 * pulse, g: 110 + pulse, b: 80 + 0.1 * pulse };
    });

    const result = analyzeRppg(input, { faceCoverage: 1, durationS: 10 });

    expect(result.heartRateBpm).toBeCloseTo(48, 0);
    expect(result.hrvRmssdMs).toBeNull();
    expect(result.hrvSdnnMs).toBeNull();
  });

  it("returns unavailable when a long capture has fewer than sixty samples", () => {
    const input = syntheticRgb().filter((_, index) => index % 20 === 0);

    const result = analyzeRppg(input, { faceCoverage: 1, durationS: 30 });

    expect(result.quality).toBe("unavailable");
  });

  it("preserves pulse accuracy when timestamps have camera jitter", () => {
    const input = syntheticRgb().map((sample, index) => ({ ...sample, t: sample.t + 4 * Math.sin(index * 1.73) }));

    const result = analyzeRppg(input, { faceCoverage: 0.95, durationS: 30 });

    expect(result.heartRateBpm).toBeCloseTo(72, 0);
    expect(result.respiratoryRateBpm).toBeCloseTo(15, 0);
  });
});
