import { describe, expect, it } from "vitest";
import { assessmentSessionSchema } from "../assessment/types";
import { sampleSession } from "./__fixtures__/sampleSession";
import { buildReportModel } from "./reportModel";

describe("reportModel", () => {
  it("validates fixture against assessmentSessionSchema", () => {
    const parsed = assessmentSessionSchema.parse(sampleSession);
    expect(parsed.id).toBe("sample-sess-001");
  });

  it("builds pure report view-model from session", () => {
    const report = buildReportModel(sampleSession);
    expect(report.title).toContain("Elderwise");
    expect(report.overallBandLabel).toBe("Steady");
    expect(report.participantLine).toBe("Age: 74 · Sex: female");
    expect(report.sections).toHaveLength(3);

    // Voice section assertions
    const voiceSec = report.sections[0]!;
    expect(voiceSec.title).toBe("Voice Acoustic Analysis");
    expect(voiceSec.band).toBe("good");
    expect(voiceSec.rows.find((r) => r.label.includes("F0"))?.value).toBe("207.8 Hz");

    // Vitals section assertions
    const vitalsSec = report.sections[1]!;
    expect(vitalsSec.rows.find((r) => r.label.includes("Heart Rate"))?.value).toBe("66 bpm");

    // Eye section assertions
    const eyeSec = report.sections[2]!;
    expect(eyeSec.rows.find((r) => r.label.includes("Saccade Latency"))?.value).toBe("232 ms");

    expect(report.summaryText).toContain("steady");
    expect(report.disclaimer).toContain("Elderwise provides wellness estimates only");
  });

  it("handles null sections gracefully", () => {
    const nullSession = {
      ...sampleSession,
      voice: null,
      vitals: null,
      eye: null,
      summaryText: null,
    };
    const report = buildReportModel(nullSession);
    expect(report.sections[0]?.rows[0]?.value).toBe("Not available");
    expect(report.sections[1]?.rows[0]?.value).toBe("Not available");
    expect(report.sections[2]?.rows[0]?.value).toBe("Not available");
    expect(report.summaryText).toBeNull();
  });
});
