export interface GazeSample {
  readonly t: number;
  readonly x: number;
  readonly y: number;
  readonly blink: boolean;
  readonly valid: boolean;
}

export interface GazePoint {
  readonly x: number;
  readonly y: number;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Unmirrored camera coordinates are reversed: screen-left = 0, screen-right = 1.
 * Right-eye inner/outer map to 0/1; left-eye inner/outer map to 1/0.
 * This is an iris-position proxy, not calibrated point-of-regard. */
export function gazeFromLandmarks(
  landmarks: readonly GazePoint[],
  blendshapes?: ReadonlyMap<string, number>,
): GazePoint & { readonly blink: boolean } {
  const eyes = [
    { iris: 468, inner: 133, outer: 33, upper: 159, lower: 145 },
    { iris: 473, inner: 362, outer: 263, upper: 386, lower: 374 },
  ];
  let x = 0;
  let y = 0;
  let blink = Math.max(blendshapes?.get("eyeBlinkLeft") ?? 0,
    blendshapes?.get("eyeBlinkRight") ?? 0) > 0.5;
  for (const eye of eyes) {
    const iris = landmarks[eye.iris];
    const inner = landmarks[eye.inner];
    const outer = landmarks[eye.outer];
    const upper = landmarks[eye.upper];
    const lower = landmarks[eye.lower];
    if (!iris || !inner || !outer || !upper || !lower ||
      ![iris, inner, outer, upper, lower].every(point =>
        Number.isFinite(point.x) && Number.isFinite(point.y)) || outer.x === inner.x) {
      return { x: NaN, y: NaN, blink };
    }
    const horizontal = (iris.x - inner.x) / (outer.x - inner.x);
    x += clamp(outer.x > inner.x ? 1 - horizontal : horizontal);
    const lidDistance = Math.hypot(lower.x - upper.x, lower.y - upper.y);
    const width = Math.hypot(outer.x - inner.x, outer.y - inner.y);
    blink ||= lidDistance / width < 0.18;
    y += lower.y === upper.y ? 0.5 : clamp((iris.y - upper.y) / (lower.y - upper.y));
  }
  return { x: x / 2, y: y / 2, blink };
}

export function usable(sample: GazeSample | undefined): sample is GazeSample & { readonly valid: true; readonly blink: false } {
  return sample !== undefined && sample.valid && !sample.blink &&
    Number.isFinite(sample.t) && Number.isFinite(sample.x) && Number.isFinite(sample.y);
}

/** Per-task 5th-95th percentile auto-scaling, NOT calibration. This changes
 * absolute gain/dispersion: compare only like-for-like proxy task recordings.
 * Blinks cannot establish the range; constant axes remain unchanged. */
export function normaliseGaze(samples: readonly GazeSample[]): GazeSample[] {
  const valid = samples.filter(usable);
  const ranges = (["x", "y"] as const).map(axis => {
    const values = valid.map(sample => sample[axis]).sort((left, right) => left - right);
    const percentile = (fraction: number) => {
      const position = (values.length - 1) * fraction;
      const lower = values[Math.floor(position)];
      const upper = values[Math.ceil(position)];
      return lower === undefined || upper === undefined ? 0 : lower + (upper - lower) * (position % 1);
    };
    return { axis, low: percentile(0.05), high: percentile(0.95) };
  });
  return samples.map(sample => {
    if (!usable(sample)) return { ...sample };
    const point = { x: sample.x, y: sample.y };
    for (const { axis, low, high } of ranges) {
      point[axis] = high > low ? clamp(0.05 + 0.9 * (point[axis] - low) / (high - low)) : clamp(point[axis]);
    }
    return { ...sample, ...point };
  });
}
