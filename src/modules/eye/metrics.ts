import { usable } from "./gaze";
import type { GazePoint, GazeSample } from "./gaze";

export interface TargetJump {
  readonly tMs: number;
  readonly from: GazePoint;
  readonly to: GazePoint;
}

export interface Saccade {
  readonly startIdx: number;
  readonly endIdx: number;
  readonly onsetMs: number;
  readonly durationMs: number;
  readonly amplitude: number;
  readonly peakVelocity: number;
  /** Signed horizontal displacement is required for latency direction matching. */
  readonly deltaX: number;
}

/** Central differences never bridge missing/blink frames or gaps over 100 ms. */
function derivative(samples: readonly GazeSample[], horizontal = false): Float64Array {
  const output = new Float64Array(samples.length).fill(NaN);
  for (let index = 1; index < samples.length - 1; index++) {
    const before = samples[index - 1];
    const current = samples[index];
    const after = samples[index + 1];
    if (!usable(before) || !usable(current) || !usable(after)) continue;
    if (current.t <= before.t || after.t <= current.t ||
      current.t - before.t > 100 || after.t - current.t > 100) continue;
    const dx = after.x - before.x;
    output[index] = (horizontal ? dx : Math.hypot(dx, after.y - before.y)) * 1000 / (after.t - before.t);
  }
  return output;
}

export function velocity(samples: readonly GazeSample[]): Float64Array {
  return derivative(samples);
}

/** I-VT enters at 1.5 units/s and exits at half that threshold (hysteresis).
 * Endpoints include the differentiation support to preserve full amplitude. */
export function detectSaccades(
  samples: readonly GazeSample[],
  opts: { readonly velocityThreshold?: number; readonly minDurationMs?: number } = {},
): Saccade[] {
  const threshold = opts.velocityThreshold ?? 1.5;
  const minimum = opts.minDurationMs ?? 15;
  const speeds = velocity(samples);
  const result: Saccade[] = [];
  let onset = -1;
  let peak = 0;
  for (let index = 0; index <= speeds.length; index++) {
    const speed = speeds[index] ?? NaN;
    if (onset < 0 && speed >= threshold) onset = index;
    if (onset < 0) continue;
    if (Number.isFinite(speed) && speed >= threshold / 2) {
      peak = Math.max(peak, speed);
      continue;
    }
    const startIdx = Math.max(0, onset - 1);
    const endIdx = Math.min(samples.length - 1, index);
    const start = samples[startIdx];
    const end = samples[endIdx];
    const firstFast = samples[onset];
    const lastFast = samples[index - 1];
    if (usable(start) && usable(end) && firstFast && lastFast &&
      lastFast.t - firstFast.t >= minimum) {
      result.push({ startIdx, endIdx, onsetMs: firstFast.t,
        durationMs: end.t - start.t, amplitude: Math.hypot(end.x - start.x, end.y - start.y),
        peakVelocity: peak, deltaX: end.x - start.x });
    }
    onset = -1;
    peak = 0;
  }
  return result;
}

function saccadeMask(samples: readonly GazeSample[]): Uint8Array {
  const mask = new Uint8Array(samples.length);
  for (const event of detectSaccades(samples)) mask.fill(1, event.startIdx, event.endIdx + 1);
  return mask;
}

/** from/to are inclusive task-relative milliseconds. */
export function fixationStability(samples: readonly GazeSample[], from = -Infinity, to = Infinity): number | null {
  const mask = saccadeMask(samples);
  const points = samples.filter((sample, index) => usable(sample) && !mask[index] && sample.t >= from && sample.t <= to);
  if (points.length < 2) return null;
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  return Math.sqrt(points.reduce((sum, point) => sum + (point.x - meanX) ** 2 + (point.y - meanY) ** 2, 0) / points.length);
}

export function saccadeLatencies(saccades: readonly Saccade[], targetJumps: readonly TargetJump[], windowMs = 800): number[] {
  return targetJumps.flatMap(jump => {
    const event = saccades.filter(saccade => saccade.onsetMs - jump.tMs > 80 &&
      saccade.onsetMs - jump.tMs <= windowMs &&
      Math.sign(saccade.deltaX) === Math.sign(jump.to.x - jump.from.x))
      .sort((left, right) => left.onsetMs - right.onsetMs)[0];
    return event ? [event.onsetMs - jump.tMs] : [];
  });
}

export function saccadeAccuracy(samples: readonly GazeSample[], targetJumps: readonly TargetJump[], settleMs = 600): number | null {
  const scores: number[] = [];
  for (const jump of targetJumps) {
    const time = jump.tMs + settleMs;
    const afterIdx = samples.findIndex(sample => sample.t >= time);
    const after = samples[afterIdx];
    const before = after?.t === time ? after : samples[afterIdx - 1];
    const amplitude = Math.hypot(jump.to.x - jump.from.x, jump.to.y - jump.from.y);
    if (!usable(before) || !usable(after) || after.t - before.t > 100 || amplitude === 0) continue;
    const weight = after.t === before.t ? 0 : (time - before.t) / (after.t - before.t);
    const x = before.x + weight * (after.x - before.x);
    const y = before.y + weight * (after.y - before.y);
    scores.push(Math.max(0, Math.min(1, 1 - Math.hypot(x - jump.to.x, y - jump.to.y) / amplitude)));
  }
  return scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null;
}

/** Horizontal RMS velocity ratio (not correlation); exclude saccades and their
 * derivative support. Zero target motion has no defined gain. */
export function pursuitGain(samples: readonly GazeSample[], targetAt: (tMs: number) => GazePoint): number | null {
  const gaze = derivative(samples, true);
  const target = derivative(samples.map(sample => ({ ...sample, ...targetAt(sample.t) })), true);
  const mask = saccadeMask(samples);
  let gazePower = 0;
  let targetPower = 0;
  let count = 0;
  for (let index = 1; index < samples.length - 1; index++) {
    const gazeSpeed = gaze[index] ?? NaN;
    const targetSpeed = target[index] ?? NaN;
    if (mask[index - 1] || mask[index] || mask[index + 1] || !Number.isFinite(gazeSpeed) || !Number.isFinite(targetSpeed)) continue;
    gazePower += gazeSpeed ** 2;
    targetPower += targetSpeed ** 2;
    count++;
  }
  return count >= 2 && targetPower > 0 ? Math.sqrt(gazePower / targetPower) : null;
}

/** Only fully observed 50-500 ms episodes count; gaps censor an episode.
 * The denominator is tracked observation time, not time with the face absent. */
export function blinkRatePerMin(samples: readonly GazeSample[]): number | null {
  let start: number | null = null;
  let count = 0;
  let observedMs = 0;
  for (let index = 1; index < samples.length; index++) {
    const before = samples[index - 1];
    const current = samples[index];
    if (!before || !current) continue;
    const interval = current.t - before.t;
    if (!before.valid || !current.valid || !Number.isFinite(interval) || interval <= 0 || interval > 100) {
      start = null;
      continue;
    }
    observedMs += interval;
    if (current.blink && !before.blink) start = current.t;
    if (!current.blink && start !== null) {
      const duration = current.t - start;
      if (duration >= 50 && duration <= 500) count++;
      start = null;
    }
  }
  return observedMs > 0 ? count * 60000 / observedMs : null;
}

export function trackingCoverage(samples: readonly GazeSample[]): number {
  return samples.length ? samples.filter(sample => sample.valid &&
    Number.isFinite(sample.t) && Number.isFinite(sample.x) && Number.isFinite(sample.y)).length / samples.length : 0;
}
