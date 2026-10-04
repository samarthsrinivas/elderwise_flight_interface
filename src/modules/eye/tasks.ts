import type { EyeTaskId } from "../assessment/types";
import type { GazePoint } from "./gaze";
import type { TargetJump } from "./metrics";

/** Anything the sampling loop can drive: a timed target plus spoken instructions. */
export interface CaptureSchedule {
  readonly durationMs: number;
  readonly targetAt: (tMs: number) => GazePoint;
  readonly instructions: string;
}

export interface TargetSchedule extends CaptureSchedule {
  readonly task: EyeTaskId;
  readonly jumps: TargetJump[];
}

export const EYE_TASK_ORDER = ["fixation", "prosaccade", "smooth-pursuit"] as const;

export function fixationSchedule(): TargetSchedule {
  return { task: "fixation", durationMs: 10000, targetAt: () => ({ x: 0.5, y: 0.5 }),
    jumps: [], instructions: "Look at the dot and keep your eyes still." };
}

export function prosaccadeSchedule(seed = 1): TargetSchedule {
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  let nextX = random() < 0.5 ? 0.2 : 0.8;
  let position = { x: 0.5, y: 0.5 };
  let durationMs = 1500;
  const jumps: TargetJump[] = [];
  // Randomise the first side and dwell times; alternate thereafter so all 12
  // trials are actual jumps rather than repeated positions.
  for (let trial = 0; trial < 12; trial++) {
    const to = { x: nextX, y: 0.5 };
    jumps.push({ tMs: durationMs, from: position, to });
    position = to;
    nextX = nextX === 0.2 ? 0.8 : 0.2;
    durationMs += 1200 + random() * 600;
  }
  return { task: "prosaccade", durationMs, jumps,
    instructions: "When the dot jumps, look at it as quickly as you can.",
    targetAt(tMs) {
      let target = { x: 0.5, y: 0.5 };
      for (const jump of jumps) {
        if (jump.tMs > tMs) break;
        target = jump.to;
      }
      return target;
    } };
}

export function smoothPursuitSchedule(): TargetSchedule {
  return { task: "smooth-pursuit", durationMs: 15000, jumps: [],
    targetAt: tMs => ({ x: 0.5 + 0.3 * Math.sin(2 * Math.PI * 0.25 * tMs / 1000), y: 0.5 }),
    instructions: "Follow the moving dot with your eyes, keeping your head still." };
}

export function scheduleFor(task: EyeTaskId): TargetSchedule {
  switch (task) {
    case "fixation": return fixationSchedule();
    case "prosaccade": return prosaccadeSchedule();
    case "smooth-pursuit": return smoothPursuitSchedule();
    default: return assertNever(task);
  }
}

export function assertNever(value: never): never {
  throw new RangeError(`Unknown eye task: ${String(value)}`);
}
