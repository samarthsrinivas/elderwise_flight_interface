import { describe, expect, it } from "vitest";
import { sampleSession } from "../export/__fixtures__/sampleSession";
import {
  buildSession,
  fallbackSummary,
  newSessionId,
  nextStep,
  overallBand,
  prevStep,
} from "./flow";
import type { BandTone, EyeResult, VitalsResult, VoiceResult } from "./types";

function mockVoice(band: BandTone): VoiceResult {
  return {
    ...sampleSession.voice!,
    band,
  };
}

function mockVitals(band: BandTone): VitalsResult {
  return {
    ...sampleSession.vitals!,
    band,
  };
}

function mockEye(band: BandTone): EyeResult {
  return {
    ...sampleSession.eye!,
    band,
  };
}

describe("flow step transitions", () => {
  it("advances sequentially from setup to summary and clamps at summary", () => {
    expect(nextStep("setup")).toBe("voice");
    expect(nextStep("voice")).toBe("vitals");
    expect(nextStep("vitals")).toBe("eye");
    expect(nextStep("eye")).toBe("summary");
    expect(nextStep("summary")).toBe("summary");
  });

  it("retreats sequentially from summary to setup and clamps at setup", () => {
    expect(prevStep("summary")).toBe("eye");
    expect(prevStep("eye")).toBe("vitals");
    expect(prevStep("vitals")).toBe("voice");
    expect(prevStep("voice")).toBe("setup");
    expect(prevStep("setup")).toBe("setup");
  });
});

describe("overallBand precedence", () => {
  it("defaults to moderate when all modules are null", () => {
    expect(overallBand({ voice: null, vitals: null, eye: null })).toBe("moderate");
  });

  it("yields good when all present modules are good", () => {
    expect(overallBand({ voice: mockVoice("good"), vitals: null, eye: null })).toBe("good");
    expect(overallBand({ voice: mockVoice("good"), vitals: mockVitals("good"), eye: mockEye("good") })).toBe("good");
  });

  it("prefers limited over moderate and good", () => {
    expect(overallBand({
      voice: mockVoice("good"),
      vitals: mockVitals("moderate"),
      eye: mockEye("limited"),
    })).toBe("limited");

    expect(overallBand({
      voice: mockVoice("limited"),
      vitals: mockVitals("good"),
      eye: null,
    })).toBe("limited");
  });

  it("prefers moderate over good", () => {
    expect(overallBand({
      voice: mockVoice("good"),
      vitals: mockVitals("moderate"),
      eye: null,
    })).toBe("moderate");
  });
});

describe("buildSession", () => {
  it("builds a validated AssessmentSession from valid input", () => {
    const session = buildSession({
      id: "test-sess-1",
      startedAt: "2026-10-04T10:00:00.000Z",
      completedAt: "2026-10-04T10:05:00.000Z",
      participant: { age: 72, sex: "female" },
      voice: sampleSession.voice,
      vitals: sampleSession.vitals,
      eye: sampleSession.eye,
      summaryText: null,
    });

    expect(session.id).toBe("test-sess-1");
    expect(session.overallBand).toBe("good");
    expect(session.participant.age).toBe(72);
  });

  it("throws validation error when participant age is out of bounds", () => {
    expect(() =>
      buildSession({
        id: "test-sess-2",
        startedAt: "2026-10-04T10:00:00.000Z",
        completedAt: "2026-10-04T10:05:00.000Z",
        participant: { age: 15, sex: "female" },
        voice: null,
        vitals: null,
        eye: null,
        summaryText: null,
      }),
    ).toThrow();
  });
});

describe("fallbackSummary", () => {
  it("contains band label, metrics, and disclaimer for a complete session", () => {
    const summary = fallbackSummary(sampleSession);

    expect(summary).toContain("Voice acoustics, facial vitals, and eye tracking were completed.");
    expect(summary).toContain("Steady");
    expect(summary).toContain("voice pitch averaged 208 Hz");
    expect(summary).toContain("resting heart rate was estimated at 66 bpm");
    expect(summary).toContain("breathing rate was estimated at 15 breaths/min");
    expect(summary).toContain("prosaccade reaction latency was 232 ms");
    expect(summary).toContain("Elderwise provides wellness estimates only. It is not a medical device and does not diagnose any condition.");
  });

  it("handles all-null modules gracefully without breaking", () => {
    const emptySession = buildSession({
      id: "empty-1",
      startedAt: "2026-10-04T10:00:00.000Z",
      completedAt: "2026-10-04T10:05:00.000Z",
      participant: { age: null, sex: "unspecified" },
      voice: null,
      vitals: null,
      eye: null,
      summaryText: null,
    });

    const summary = fallbackSummary(emptySession);
    expect(summary).toContain("All check-in modules were skipped.");
    expect(summary).toContain("Watch");
    expect(summary).toContain("Elderwise provides wellness estimates only. It is not a medical device and does not diagnose any condition.");
  });
});

describe("newSessionId", () => {
  it("generates a non-empty string identifier", () => {
    const id1 = newSessionId();
    const id2 = newSessionId();
    expect(typeof id1).toBe("string");
    expect(id1.length).toBeGreaterThan(0);
    expect(id1).not.toBe(id2);
  });
});
