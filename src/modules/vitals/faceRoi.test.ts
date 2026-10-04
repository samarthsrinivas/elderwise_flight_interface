import { describe, expect, it, vi } from "vitest";
import type { NormalizedLandmark } from "../../lib/faceLandmarker";
import { cheekRois, foreheadRoi, meanRgb } from "./faceRoi";

function landmarks(): NormalizedLandmark[] {
  const points = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  points[10].y = 0.1; points[151].y = 0.3;
  points[70].x = 0.3; points[300].x = 0.7;
  points[50] = { x: 0.2, y: 0.4, z: 0, visibility: 1 };
  points[101] = { x: 0.35, y: 0.45, z: 0, visibility: 1 };
  points[205] = { x: 0.25, y: 0.6, z: 0, visibility: 1 };
  points[280] = { x: 0.8, y: 0.4, z: 0, visibility: 1 };
  points[330] = { x: 0.65, y: 0.45, z: 0, visibility: 1 };
  points[425] = { x: 0.75, y: 0.6, z: 0, visibility: 1 };
  return points;
}

describe("face color sampling", () => {
  it("insets forehead geometry when given normalized landmarks", () => {
    const points = landmarks();

    const roi = foreheadRoi(points, 1000, 500);

    expect(roi.x).toBeCloseTo(320);
    expect(roi.y).toBeCloseTo(55);
    expect(roi.w).toBeCloseTo(360);
    expect(roi.h).toBeCloseTo(90);
  });

  it("creates separated cheek patches when face geometry is available", () => {
    const points = landmarks();

    const [right, left] = cheekRois(points, 1000, 500);

    expect(right.x + right.w).toBeLessThan(500);
    expect(left.x).toBeGreaterThan(500);
    expect(right.w).toBeCloseTo(left.w);
    expect(right.h).toBeCloseTo(90);
  });

  it("returns an empty ROI when landmarks are missing", () => {
    const points: NormalizedLandmark[] = [];

    const roi = foreheadRoi(points, 640, 480);

    expect(roi.w * roi.h).toBe(0);
  });

  it("clamps bounds and averages alternate pixels when reading canvas", () => {
    const getImageData = vi.fn(() => ({ data: new Uint8ClampedArray([10, 20, 30, 255, 240, 240, 240, 255, 30, 40, 50, 255, 240, 240, 240, 255]) }));
    const ctx = { canvas: { width: 4, height: 1 }, getImageData };

    const result = meanRgb(ctx, { x: -2, y: 0, w: 6, h: 2 });

    expect(result).toEqual({ r: 20, g: 30, b: 40 });
    expect(getImageData).toHaveBeenCalledWith(0, 0, 4, 1);
  });

  it("skips canvas reads when the ROI is outside the frame", () => {
    const getImageData = vi.fn(() => ({ data: new Uint8ClampedArray() }));
    const ctx = { canvas: { width: 4, height: 1 }, getImageData };

    const result = meanRgb(ctx, { x: 8, y: 0, w: 2, h: 1 });

    expect(result).toBeNull();
    expect(getImageData).not.toHaveBeenCalled();
  });
});
