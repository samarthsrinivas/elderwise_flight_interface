import { describe, expect, it } from "vitest";
import { VOICE_TASKS, voiceTaskSpec } from "./tasks";

describe("guided voice tasks", () => {
  it("provides three unique tasks when starting a voice assessment", () => {
    const ids = VOICE_TASKS.map((task) => task.id);
    expect(ids).toEqual(["sustained-vowel", "reading-passage", "free-speech"]);
    expect(new Set(ids).size).toBe(3);
  });

  it.each(VOICE_TASKS)("resolves $id with a positive recording duration", (task) => {
    const spec = voiceTaskSpec(task.id);
    expect(spec).toEqual(task);
    expect(spec.durationS).toBeGreaterThan(0);
  });
});
