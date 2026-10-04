/** Head orientation derived from MediaPipe's facial transformation matrix.
 *
 * The matrix arrives as a flat 4x4 `data` array. MediaPipe serialises Eigen
 * matrices column-major (translation at indices 12..14), which is what this
 * module assumes. Elderwise only uses head pose as a *deviation* from a
 * per-session reference, so a layout or handedness mismatch would flip signs
 * but never change the size of a movement. */
export interface HeadPose {
  readonly yawDeg: number;
  readonly pitchDeg: number;
  readonly rollDeg: number;
}

const toDegrees = (radians: number) => radians * 180 / Math.PI;
const clampUnit = (value: number) => Math.max(-1, Math.min(1, value));

/** Decomposes the upper-left 3x3 rotation as R = Ry(yaw) * Rx(pitch) * Rz(roll).
 * Accepts a 4x4 (16 values) or 3x3 (9 values) column-major matrix; returns
 * null for anything else or for non-finite values. */
export function headPoseFromMatrix(data: readonly number[]): HeadPose | null {
  const stride = data.length === 16 ? 4 : data.length === 9 ? 3 : 0;
  if (stride === 0) return null;
  const at = (row: number, column: number) => data[column * stride + row] ?? NaN;
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      if (!Number.isFinite(at(row, column))) return null;
    }
  }
  return {
    yawDeg: toDegrees(Math.atan2(at(0, 2), at(2, 2))) + 0,
    pitchDeg: toDegrees(Math.asin(clampUnit(-at(1, 2)))) + 0,
    rollDeg: toDegrees(Math.atan2(at(1, 0), at(1, 1))) + 0,
  };
}

/** Angular distance on the yaw/pitch plane; roll is ignored because tilting
 * the head barely moves the iris proxy. */
export function headPoseDeviationDeg(
  pose: Pick<HeadPose, "yawDeg" | "pitchDeg">,
  reference: Pick<HeadPose, "yawDeg" | "pitchDeg">,
): number {
  return Math.hypot(pose.yawDeg - reference.yawDeg, pose.pitchDeg - reference.pitchDeg);
}
