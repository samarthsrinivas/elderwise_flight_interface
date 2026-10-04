import { describe, expect, it } from "vitest";
import { EYE_TASK_ORDER, prosaccadeSchedule, scheduleFor } from "./tasks";

describe("target schedules", () => {
  it("repeats jumps and holds when the same seed is supplied", () => {
    const first = prosaccadeSchedule(42);
    const second = prosaccadeSchedule(42);
    expect(second.jumps).toEqual(first.jumps);
    expect(second.durationMs).toBe(first.durationMs);
  });
  it("changes timing when a different seed is supplied", () => {
    const first = prosaccadeSchedule(1);
    const second = prosaccadeSchedule(7);
    expect(second.jumps).not.toEqual(first.jumps);
  });
  it("creates twelve alternating jumps with bounded holds when scheduled", () => {
    const schedule = prosaccadeSchedule();
    const holds = schedule.jumps.map((jump, index) => (schedule.jumps[index + 1]?.tMs ?? schedule.durationMs) - jump.tMs);
    expect(schedule.jumps).toHaveLength(12);
    expect(schedule.jumps[0]?.tMs).toBe(1500);
    expect(schedule.jumps.every(jump => jump.from.x !== jump.to.x)).toBe(true);
    expect(holds.every(hold => hold >= 1200 && hold <= 1800)).toBe(true);
  });
  it.each(EYE_TASK_ORDER)("keeps %s targets on screen throughout its duration", task => {
    const schedule = scheduleFor(task);
    const points = Array.from({ length: 1001 }, (_, index) => schedule.targetAt(index * schedule.durationMs / 1000));
    expect(points.every(point => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1)).toBe(true);
  });
  it("switches at the exact jump timestamp when a hold ends", () => {
    const schedule = prosaccadeSchedule();
    const first = schedule.jumps[0];
    expect(first).toBeDefined();
    if (!first) return;
    const targets = [schedule.targetAt(first.tMs - 1), schedule.targetAt(first.tMs)];
    expect(targets).toEqual([first.from, first.to]);
  });
});
