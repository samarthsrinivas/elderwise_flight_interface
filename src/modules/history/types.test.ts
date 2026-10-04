import { describe, expect, it } from "vitest";
import type { AssessmentSession } from "../assessment/types";
import { parseSessionRecords, sessionRecordSchema } from "./types";

const mockSession: AssessmentSession = {
  id: "test-sess-1",
  startedAt: "2026-10-01T10:00:00.000Z",
  completedAt: "2026-10-01T10:05:00.000Z",
  participant: {
    age: 72,
    sex: "female",
  },
  voice: {
    tasks: [],
    markers: {
      f0MeanHz: 195.4,
      f0SdHz: 12.1,
      jitterPct: 1.2,
      shimmerPct: 3.4,
      hnrDb: 18.2,
      speechRateSylPerS: 3.5,
      articulationRateSylPerS: 4.1,
      pauseRatio: 0.2,
      pauseCount: 4,
      voicedRatio: 0.65,
    },
    quality: "good",
    band: "good",
    age: null,
  },
  vitals: {
    heartRateBpm: 68.5,
    hrvRmssdMs: 42.1,
    hrvSdnnMs: 48.0,
    respiratoryRateBpm: 15.2,
    signalToNoise: 0.85,
    quality: "good",
    durationS: 30,
    sampleCount: 900,
    effectiveFps: 30,
    faceCoverage: 0.98,
    band: "good",
  },
  eye: {
    tasks: [
      {
        task: "prosaccade",
        durationS: 15,
        sampleCount: 450,
        trackingCoverage: 0.96,
        fixationStability: 0.02,
        saccadeCount: 10,
        meanSaccadeLatencyMs: 245.5,
        meanSaccadePeakVelocity: 4.2,
        saccadeAccuracy: 0.9,
        pursuitGain: 0.92,
        blinkRatePerMin: 14,
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
  summaryText: "Voice and vitals are in optimal range.",
};

describe("history types and schemas", () => {
  it("validates assessment session as session record", () => {
    const parsed = sessionRecordSchema.parse(mockSession);
    expect(parsed.id).toBe("test-sess-1");
    expect(parsed.voice?.markers.f0MeanHz).toBe(195.4);
    expect(parsed.vitals?.heartRateBpm).toBe(68.5);
  });

  it("parses array of sessions and sorts newest first", () => {
    const older = {
      ...mockSession,
      id: "older-1",
      startedAt: "2026-09-01T10:00:00.000Z",
    };
    const parsed = parseSessionRecords([older, mockSession, { invalid: true }]);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.id).toBe("test-sess-1");
    expect(parsed[1]?.id).toBe("older-1");
  });
});
