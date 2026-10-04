import { describe, expect, it } from "vitest";
import { cameraStatusText } from "./EyeTaskCanvas";

describe("cameraStatusText", () => {
  it("never claims a face result while the camera is off", () => {
    expect(cameraStatusText("idle", false)).toBe("Camera off");
    expect(cameraStatusText("error", false)).toBe("Camera off");
    expect(cameraStatusText("idle", true)).toBe("Camera off");
  });
  it("reports the start-up stage before detection runs", () => {
    expect(cameraStatusText("requesting", false)).toBe("Starting camera…");
    expect(cameraStatusText("loading-model", false)).toBe("Loading face model…");
  });
  it("reports face detection only while sampling", () => {
    expect(cameraStatusText("running", true)).toBe("Face detected");
    expect(cameraStatusText("running", false)).toBe("Face not detected");
    expect(cameraStatusText("analyzing", false)).toBe("Face not detected");
    expect(cameraStatusText("done", false)).toBe("Camera ready");
  });
});
