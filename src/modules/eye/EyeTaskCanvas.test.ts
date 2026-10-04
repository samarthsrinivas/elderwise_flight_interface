import { describe, expect, it } from "vitest";
import type { EyeResult, GazeCalibration } from "../assessment/types";
import { calibrationStatusText, cameraStatusText, resultsNote } from "./EyeTaskCanvas";

const calibration: GazeCalibration = { ax: -0.3, bx: 2, ay: -0.1, by: 1.5, residualX: 0.012, residualY: 0.034, pointsUsed: 5, headPoseRef: null };

describe("cameraStatusText", () => {
  it("never claims a face result while the camera is off", () => {
    expect(cameraStatusText("idle", false)).toBe("Camera off");
    expect(cameraStatusText("error", false)).toBe("Camera off");
    expect(cameraStatusText("idle", true)).toBe("Camera off");
  });
  it("reports the start-up stage before detection runs", () => {
    expect(cameraStatusText("requesting", false)).toBe("Starting camera…");
    expect(cameraStatusText("loading-model", false)).toBe("Loading face model…");
  });
  it("reports face detection only while sampling", () => {
    expect(cameraStatusText("running", true)).toBe("Face detected");
    expect(cameraStatusText("running", false)).toBe("Face not detected");
    expect(cameraStatusText("analyzing", false)).toBe("Face not detected");
    expect(cameraStatusText("done", false)).toBe("Camera ready");
  });
});

describe("calibrationStatusText", () => {
  it("reports the worse axis residual as a screen percentage", () => {
    expect(calibrationStatusText("ok", calibration)).toBe("Calibrated · fit error 3.4% of screen");
  });
  it("asks for a retry or skip after a noisy fit", () => {
    expect(calibrationStatusText("failed", null)).toBe("Calibration too noisy — try again or skip");
  });
  it("warns that uncalibrated results are capped", () => {
    expect(calibrationStatusText("none", null)).toBe("Not calibrated — results limited to Watch");
    expect(calibrationStatusText("skipped", null)).toBe("Not calibrated — results limited to Watch");
    expect(calibrationStatusText("ok", null)).toBe("Not calibrated — results limited to Watch");
  });
});

describe("resultsNote", () => {
  const base: EyeResult = { tasks: [], quality: "good", band: "good", calibration: null };
  it("explains calibrated results with the fit error", () => {
    expect(resultsNote({ ...base, calibration })).toBe(
      "Tracking quality: good. Calibrated to this screen (fit error 3.4%). Wellness estimates, not diagnostic measurements.",
    );
  });
  it("flags proxy results as auto-scaled and unbanded", () => {
    expect(resultsNote({ ...base, quality: "fair", band: "moderate" })).toBe(
      "Tracking quality: fair. Uncalibrated gaze proxies: stability and gain are auto-scaled and not banded.",
    );
  });
});
