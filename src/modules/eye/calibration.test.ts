import { describe, expect, it } from "vitest";
import { gazeCalibrationSchema } from "../assessment/types";
import {
  CALIBRATION_DWELL_MS,
  CALIBRATION_POINTS,
  CALIBRATION_SETTLE_MS,
  HEAD_POSE_TOLERANCE_DEG,
  applyCalibration,
  calibrationSchedule,
  fitCalibration,
  gateHeadPose,
  headMotionDeg,
} from "./calibration";
import type { GazeSample } from "./gaze";

const TRUE_MAP = { ax: -0.3, bx: 2, ay: -0.1, by: 1.5 };

/** Inverts TRUE_MAP so a synthetic participant's proxy lands exactly on `screen`. */
const proxyFor = (screen: { x: number; y: number }) => ({
  x: (screen.x - TRUE_MAP.ax) / TRUE_MAP.bx,
  y: (screen.y - TRUE_MAP.ay) / TRUE_MAP.by,
});

interface SampleOptions {
  readonly hz?: number;
  readonly noise?: number;
  readonly skipDots?: readonly number[];
  readonly head?: GazeSample["head"];
}

function calibrationSamples(options: SampleOptions = {}): GazeSample[] {
  const { hz = 30, noise = 0, skipDots = [], head } = options;
  const schedule = calibrationSchedule();
  const samples: GazeSample[] = [];
  let seed = 7;
  const jitter = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return (seed / 2147483648 - 0.5) * 2 * noise;
  };
  for (let t = 0; t < schedule.durationMs; t += 1000 / hz) {
    const dot = Math.floor(t / CALIBRATION_DWELL_MS);
    const proxy = proxyFor(schedule.targetAt(t));
    samples.push({
      t,
      x: proxy.x + jitter(),
      y: proxy.y + jitter(),
      blink: false,
      valid: !skipDots.includes(dot),
      head,
    });
  }
  return samples;
}

describe("calibrationSchedule", () => {
  it("shows five dots for two seconds each and clamps past the end", () => {
    const schedule = calibrationSchedule();
    expect(schedule.durationMs).toBe(10_000);
    expect(schedule.targetAt(0)).toEqual(CALIBRATION_POINTS[0]);
    expect(schedule.targetAt(CALIBRATION_DWELL_MS * 4 + 1)).toEqual(CALIBRATION_POINTS[4]);
    expect(schedule.targetAt(99_999)).toEqual(CALIBRATION_POINTS[4]);
    expect(schedule.targetAt(-5)).toEqual(CALIBRATION_POINTS[0]);
    expect(schedule.instructions).toMatch(/head still/i);
  });
});

describe("fitCalibration", () => {
  it("recovers an exact linear map from noiseless samples", () => {
    const calibration = fitCalibration(calibrationSamples());
    expect(calibration).not.toBeNull();
    expect(gazeCalibrationSchema.parse(calibration)).toEqual(calibration);
    expect(calibration?.ax).toBeCloseTo(TRUE_MAP.ax, 6);
    expect(calibration?.bx).toBeCloseTo(TRUE_MAP.bx, 6);
    expect(calibration?.ay).toBeCloseTo(TRUE_MAP.ay, 6);
    expect(calibration?.by).toBeCloseTo(TRUE_MAP.by, 6);
    expect(calibration?.residualX).toBeCloseTo(0, 6);
    expect(calibration?.residualY).toBeCloseTo(0, 6);
    expect(calibration?.pointsUsed).toBe(5);
    expect(calibration?.headPoseRef).toBeNull();
  });

  it("tolerates small jitter and still fits within the residual bound", () => {
    const calibration = fitCalibration(calibrationSamples({ noise: 0.01 }));
    expect(calibration).not.toBeNull();
    expect(calibration?.bx).toBeCloseTo(TRUE_MAP.bx, 0);
    expect(calibration?.residualX).toBeLessThan(0.06);
    expect(calibration?.residualY).toBeLessThan(0.06);
  });

  it("ignores samples during the settle window", () => {
    const schedule = calibrationSchedule();
    const samples = calibrationSamples().map(sample =>
      sample.t % CALIBRATION_DWELL_MS < CALIBRATION_SETTLE_MS ? { ...sample, x: 5, y: 5 } : sample,
    );
    const calibration = fitCalibration(samples);
    expect(calibration?.ax).toBeCloseTo(TRUE_MAP.ax, 6);
    expect(schedule.durationMs).toBe(10_000);
  });

  it("fits with one dot missing but refuses with two missing", () => {
    expect(fitCalibration(calibrationSamples({ skipDots: [4] }))?.pointsUsed).toBe(4);
    expect(fitCalibration(calibrationSamples({ skipDots: [3, 4] }))).toBeNull();
  });

  it("refuses when an axis has no spread (participant never moved eyes)", () => {
    const frozen = calibrationSamples().map(sample => ({ ...sample, x: 0.4 }));
    expect(fitCalibration(frozen)).toBeNull();
  });

  it("refuses when the proxy moves against the target (negative slope)", () => {
    const mirrored = calibrationSamples().map(sample => ({ ...sample, x: 1 - sample.x }));
    expect(fitCalibration(mirrored)).toBeNull();
  });

  it("refuses when samples are too sparse", () => {
    expect(fitCalibration(calibrationSamples({ hz: 5 }))).toBeNull();
    expect(fitCalibration([])).toBeNull();
  });

  it("records the median head pose as the reference", () => {
    const calibration = fitCalibration(
      calibrationSamples({ head: { yawDeg: 3, pitchDeg: -2, rollDeg: 1 } }),
    );
    expect(calibration?.headPoseRef).toEqual({ yawDeg: 3, pitchDeg: -2 });
  });
});

describe("applyCalibration", () => {
  it("maps proxy samples onto screen coordinates and clamps extremes", () => {
    const calibration = fitCalibration(calibrationSamples());
    if (!calibration) throw new Error("fit failed");
    const mapped = applyCalibration(
      [
        { t: 0, ...proxyFor({ x: 0.3, y: 0.6 }), blink: false, valid: true },
        { t: 1, x: 99, y: -99, blink: false, valid: true },
        { t: 2, x: 0.1, y: 0.1, blink: true, valid: true },
      ],
      calibration,
    );
    expect(mapped[0].x).toBeCloseTo(0.3, 6);
    expect(mapped[0].y).toBeCloseTo(0.6, 6);
    expect(mapped[1]).toMatchObject({ x: 1.2, y: -0.2 });
    expect(mapped[2]).toMatchObject({ x: 0.1, y: 0.1, blink: true });
  });
});

describe("head pose gating", () => {
  const reference = { yawDeg: 0, pitchDeg: 0 };
  const still: GazeSample = { t: 0, x: 0.5, y: 0.5, blink: false, valid: true, head: { yawDeg: 2, pitchDeg: 1, rollDeg: 0 } };
  const turned: GazeSample = { ...still, t: 1, head: { yawDeg: HEAD_POSE_TOLERANCE_DEG + 5, pitchDeg: 0, rollDeg: 0 } };
  const unknown: GazeSample = { ...still, t: 2, head: null };

  it("invalidates samples whose head has turned beyond tolerance", () => {
    const gated = gateHeadPose([still, turned, unknown], reference);
    expect(gated.map(sample => sample.valid)).toEqual([true, false, true]);
  });

  it("reports RMS head motion across all samples with a pose", () => {
    expect(headMotionDeg([still, turned, unknown], reference)).toBeCloseTo(
      Math.sqrt((Math.hypot(2, 1) ** 2 + 15 ** 2) / 2),
      6,
    );
    expect(headMotionDeg([unknown], reference)).toBeNull();
  });
});
