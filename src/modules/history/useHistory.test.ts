import { describe, expect, it } from "vitest";
import type { AssessmentSession } from "../assessment/types";
import { buildTrendSeries, sortByRecordedAt } from "./useHistory";

const session1: AssessmentSession = {
  id: "sess-1",
  startedAt: "2026-10-01T10:00:00.000Z",
  completedAt: "2026-10-01T10:05:00.000Z",
  participant: { age: 70, sex: "male" },
  voice: {
    tasks: [],
    markers: {
      f0MeanHz: 120.5,
      f0SdHz: 8,
      jitterPct: 1.1,
      shimmerPct: 2.5,
      hnrDb: 20.1,
      speechRateSylPerS: 3.2,
      articulationRateSylPerS: 3.8,
      pauseRatio: 0.15,
      pauseCount: 3,
      voicedRatio: 0.7,
    },
    quality: "good",
    band: "good",
    age: null,
  },
  vitals: {
    heartRateBpm: 72,
    hrvRmssdMs: 35,
    hrvSdnnMs: 40,
    respiratoryRateBpm: 16,
    signalToNoise: 0.9,
    quality: "good",
    durationS: 30,
    sampleCount: 900,
    effectiveFps: 30,
    faceCoverage: 1,
    band: "good",
  },
  eye: {
    tasks: [
      {
        task: "prosaccade",
        durationS: 15,
        sampleCount: 450,
        trackingCoverage: 0.95,
        fixationStability: 0.03,
        saccadeCount: 8,
        meanSaccadeLatencyMs: 260,
        meanSaccadePeakVelocity: 4.1,
        saccadeAccuracy: 0.85,
        pursuitGain: 0.9,
        blinkRatePerMin: 12,
        gazeUnits: "proxy",
        targetErrorRms: null,
        headMotionDeg: null,
      },
    ],
    quality: "good",
    band: "good",
    calibration: null,
  },
  overallBand: "good",
  summaryText: "Normal",
};

const session2: AssessmentSession = {
  ...session1,
  id: "sess-2",
  startedAt: "2026-10-02T10:00:00.000Z",
  completedAt: "2026-10-02T10:05:00.000Z",
  vitals: {
    ...session1.vitals!,
    heartRateBpm: 78,
  },
};

describe("useHistory helpers", () => {
  it("sorts sessions by recorded date ascending for trend lines", () => {
    const sorted = sortByRecordedAt([session2, session1]);
    expect(sorted[0]?.id).toBe("sess-1");
    expect(sorted[1]?.id).toBe("sess-2");
  });

  it("builds biomarker trend series", () => {
    const series = buildTrendSeries([session2, session1]);
    expect(series.heartRate).toHaveLength(2);
    expect(series.heartRate[0]?.value).toBe(72);
    expect(series.heartRate[1]?.value).toBe(78);
    expect(series.f0MeanHz[0]?.value).toBe(120.5);
    expect(series.saccadeLatency[0]?.value).toBe(260);
  });
});
