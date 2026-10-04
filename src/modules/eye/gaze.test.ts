import { describe, expect, it } from "vitest";
import { gazeFromLandmarks, normaliseGaze } from "./gaze";

function face(screenX: number, lidHeight = 0.1) {
  const points = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  points[33] = { x: 0.1, y: 0.5 };
  points[133] = { x: 0.3, y: 0.5 };
  points[362] = { x: 0.6, y: 0.5 };
  points[263] = { x: 0.8, y: 0.5 };
  points[468] = { x: 0.3 - screenX * 0.2, y: 0.5 };
  points[473] = { x: 0.8 - screenX * 0.2, y: 0.5 };
  for (const index of [159, 386]) points[index] = { x: 0.5, y: 0.5 - lidHeight / 2 };
  for (const index of [145, 374]) points[index] = { x: 0.5, y: 0.5 + lidHeight / 2 };
  return points;
}

describe("gaze proxy", () => {
  it.each([0, 0.5, 1])("maps to screen x=%s when both irises move consistently", screenX => {
    const landmarks = face(screenX);
    const gaze = gazeFromLandmarks(landmarks);
    expect(gaze.x).toBeCloseTo(screenX);
    expect(gaze.y).toBeCloseTo(0.5);
    expect(gaze.blink).toBe(false);
  });
  it("detects a blink when the lids close", () => {
    const landmarks = face(0.5, 0);
    const gaze = gazeFromLandmarks(landmarks);
    expect(gaze).toEqual({ x: expect.closeTo(0.5), y: 0.5, blink: true });
  });
  it("detects a blink when either blendshape exceeds the threshold", () => {
    const blendshapes = new Map([["eyeBlinkRight", 0.6]]);
    const gaze = gazeFromLandmarks(face(0.5), blendshapes);
    expect(gaze.blink).toBe(true);
  });
  it("rejects incomplete landmarks instead of inventing a centre gaze", () => {
    const gaze = gazeFromLandmarks([]);
    expect(Number.isNaN(gaze.x)).toBe(true);
  });
  it("maps percentile endpoints when a valid range is observed", () => {
    const samples = Array.from({ length: 101 }, (_, index) => ({ t: index, x: index / 100, y: 0.5, blink: false, valid: true }));
    const normalized = normaliseGaze(samples);
    expect(normalized[5]?.x).toBeCloseTo(0.05);
    expect(normalized[95]?.x).toBeCloseTo(0.95);
    expect(normalized[50]?.y).toBe(0.5);
  });
  it("ignores invalid and blink outliers when determining the range", () => {
    const samples = [0.4, 0.6].map((x, t) => ({ t, x, y: 0.5, blink: false, valid: true }));
    const result = normaliseGaze([...samples, { t: 2, x: 100, y: 100, valid: false, blink: false },
      { t: 3, x: -100, y: -100, valid: true, blink: true }]);
    expect(result[0]?.x).toBeCloseTo(0);
    expect(result[1]?.x).toBeCloseTo(1);
    expect(samples[0]?.x).toBe(0.4);
  });
});
