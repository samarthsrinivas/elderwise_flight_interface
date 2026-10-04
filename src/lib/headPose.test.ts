import { describe, expect, it } from "vitest";
import { headPoseDeviationDeg, headPoseFromMatrix } from "./headPose";

type Row = readonly [number, number, number];
type Rotation = readonly [Row, Row, Row];

const rad = (degrees: number) => degrees * Math.PI / 180;

const rotateY = (degrees: number): Rotation => {
  const c = Math.cos(rad(degrees));
  const s = Math.sin(rad(degrees));
  return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
};
const rotateX = (degrees: number): Rotation => {
  const c = Math.cos(rad(degrees));
  const s = Math.sin(rad(degrees));
  return [[1, 0, 0], [0, c, -s], [0, s, c]];
};
const rotateZ = (degrees: number): Rotation => {
  const c = Math.cos(rad(degrees));
  const s = Math.sin(rad(degrees));
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
};

/** Pack a row-indexed 3x3 rotation into MediaPipe's column-major 4x4 layout. */
function columnMajor4x4(rotation: Rotation, translation: Row = [1, 2, 3]): number[] {
  const data = new Array<number>(16).fill(0);
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) data[column * 4 + row] = rotation[row][column];
  }
  data[12] = translation[0];
  data[13] = translation[1];
  data[14] = translation[2];
  data[15] = 1;
  return data;
}

describe("headPoseFromMatrix", () => {
  it("recovers a pure yaw rotation", () => {
    const pose = headPoseFromMatrix(columnMajor4x4(rotateY(20)));
    expect(pose?.yawDeg).toBeCloseTo(20, 6);
    expect(pose?.pitchDeg).toBeCloseTo(0, 6);
    expect(pose?.rollDeg).toBeCloseTo(0, 6);
  });
  it("recovers a pure pitch rotation", () => {
    const pose = headPoseFromMatrix(columnMajor4x4(rotateX(15)));
    expect(pose?.pitchDeg).toBeCloseTo(15, 6);
    expect(pose?.yawDeg).toBeCloseTo(0, 6);
    expect(pose?.rollDeg).toBeCloseTo(0, 6);
  });
  it("recovers a pure roll rotation", () => {
    const pose = headPoseFromMatrix(columnMajor4x4(rotateZ(10)));
    expect(pose?.rollDeg).toBeCloseTo(10, 6);
    expect(pose?.yawDeg).toBeCloseTo(0, 6);
    expect(pose?.pitchDeg).toBeCloseTo(0, 6);
  });
  it("ignores translation and accepts a bare 3x3", () => {
    const identity = headPoseFromMatrix(columnMajor4x4(rotateY(0), [40, -12, 500]));
    expect(identity).toEqual({ yawDeg: 0, pitchDeg: 0, rollDeg: 0 });
    expect(headPoseFromMatrix([1, 0, 0, 0, 1, 0, 0, 0, 1])).toEqual({ yawDeg: 0, pitchDeg: 0, rollDeg: 0 });
  });
  it("returns null for malformed input", () => {
    expect(headPoseFromMatrix([])).toBeNull();
    expect(headPoseFromMatrix([1, 2, 3])).toBeNull();
    expect(headPoseFromMatrix(columnMajor4x4([[NaN, 0, 0], [0, 1, 0], [0, 0, 1]]))).toBeNull();
  });
});

describe("headPoseDeviationDeg", () => {
  it("measures yaw/pitch distance and ignores roll", () => {
    const reference = { yawDeg: 2, pitchDeg: -1 };
    expect(headPoseDeviationDeg({ yawDeg: 5, pitchDeg: 3 }, reference)).toBeCloseTo(5, 6);
    expect(headPoseDeviationDeg(reference, reference)).toBe(0);
  });
});
