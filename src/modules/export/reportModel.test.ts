import { describe, expect, it } from "vitest";
import { assessmentSessionSchema } from "../assessment/types";
import { sampleSession } from "./__fixtures__/sampleSession";
import { buildReportModel, formatVoiceAge } from "./reportModel";

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
    expect(eyeSec.rows.find((r) => r.label === "Gaze Calibration")?.value).toBe(
      "Calibrated (fit error 2.7% of screen)",
    );

    expect(report.summaryText).toContain("steady");
    expect(report.disclaimer).toContain("Elderwise provides wellness estimates only");
  });

  it("marks uncalibrated eye sessions as limited in the report", () => {
    const report = buildReportModel({
      ...sampleSession,
      eye: sampleSession.eye ? { ...sampleSession.eye, calibration: null } : null,
    });
    const row = report.sections[2]!.rows.find((r) => r.label === "Gaze Calibration");
    expect(row?.value).toBe("Uncalibrated (limited)");
    expect(row?.note).toContain("not banded");
  });

  it("reports the voice-age estimate against the stated age", () => {
    const report = buildReportModel(sampleSession);
    const row = report.sections[0]!.rows.find((r) => r.label === "Estimated Voice Age");
    expect(row?.value).toBe("68 years (±7.6)");
    expect(row?.note).toContain("Within model error of stated age 74.");
    expect(row?.note).toContain("not biological age");
  });

  it("marks the voice-age row unavailable when no estimate exists", () => {
    const report = buildReportModel({
      ...sampleSession,
      voice: { ...sampleSession.voice!, age: null },
    });
    const row = report.sections[0]!.rows.find((r) => r.label === "Estimated Voice Age");
    expect(row?.value).toBe("Not available");
    expect(row?.note).toBeUndefined();
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

describe("formatVoiceAge", () => {
  const age = { ageYears: 68.3, maeYears: 7.6, model: "m", tasks: [] };

  it("returns null without an estimate", () => {
    expect(formatVoiceAge(null, 74)).toBeNull();
  });

  it("omits the comparison note when stated age is unknown", () => {
    expect(formatVoiceAge(age, null)).toEqual({ value: "68 years (±7.6)", note: null });
  });

  it("describes gaps larger than the model error", () => {
    expect(formatVoiceAge(age, 55)?.note).toBe("About 13 years above stated age 55.");
    expect(formatVoiceAge(age, 80)?.note).toBe("About 12 years below stated age 80.");
  });
});
