// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EyeStep } from "./EyeStep";
import { VitalsStep } from "./VitalsStep";

vi.mock("../../../lib/faceLandmarker", () => ({
  FaceLandmarkerUnavailableError: class extends Error {},
  loadFaceLandmarkDetector: () => new Promise<never>(() => {}),
}));

interface FakeTrack {
  readonly kind: "video";
  readyState: "live" | "ended";
  stop(): void;
  addEventListener(): void;
}

function fakeCamera() {
  const track: FakeTrack = {
    kind: "video",
    readyState: "live",
    stop() { this.readyState = "ended"; },
    addEventListener() {},
  };
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
  const getUserMedia = vi.fn(() => new Promise<MediaStream>(resolve => setTimeout(() => resolve(stream), 0)));
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  return { track, getUserMedia };
}

async function clickAndAcquireCamera(button: HTMLButtonElement) {
  await act(async () => {
    button.click();
  });
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 10));
  });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLMediaElement.prototype.play = () => Promise.resolve();
  Object.defineProperty(HTMLMediaElement.prototype, "srcObject", { value: null, writable: true, configurable: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("VitalsStep camera lifecycle", () => {
  const noop = () => {};

  it("keeps the camera stream alive across the re-renders start() triggers", async () => {
    const camera = fakeCamera();
    await act(async () => {
      root.render(createElement(VitalsStep, { vitals: null, onComplete: noop, onSkip: noop, onBack: noop }));
    });

    const start = container.querySelector<HTMLButtonElement>("button.vitals-start");
    expect(start).not.toBeNull();
    await clickAndAcquireCamera(start!);

    expect(camera.getUserMedia).toHaveBeenCalledTimes(1);
    expect(camera.track.readyState).toBe("live");
    expect(container.querySelector(".vitals-phase")?.textContent).toBe("Preparing the on-device face detector...");
  });

  it("still releases the camera when the step unmounts", async () => {
    const camera = fakeCamera();
    await act(async () => {
      root.render(createElement(VitalsStep, { vitals: null, onComplete: noop, onSkip: noop, onBack: noop }));
    });
    await clickAndAcquireCamera(container.querySelector<HTMLButtonElement>("button.vitals-start")!);
    expect(camera.track.readyState).toBe("live");

    act(() => root.unmount());

    expect(camera.track.readyState).toBe("ended");
  });
});

describe("EyeStep camera lifecycle", () => {
  const noop = () => {};

  function buttonLabelled(predicate: (text: string) => boolean): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find(candidate => predicate(candidate.textContent ?? ""));
    expect(button).toBeDefined();
    return button!;
  }

  // A parallel branch adds a calibration gate before the tasks; skip it when present.
  async function skipCalibration() {
    const skip = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find(candidate => candidate.textContent === "Skip calibration");
    if (!skip) return;
    await act(async () => {
      skip.click();
    });
  }

  function firstTaskButton(): HTMLButtonElement {
    return buttonLabelled(text => text.startsWith("1."));
  }

  it("keeps the camera stream alive across the re-renders runTask() triggers", async () => {
    const camera = fakeCamera();
    await act(async () => {
      root.render(createElement(EyeStep, { eye: null, onComplete: noop, onSkip: noop, onBack: noop }));
    });

    await skipCalibration();
    await clickAndAcquireCamera(firstTaskButton());

    expect(camera.getUserMedia).toHaveBeenCalledTimes(1);
    expect(camera.track.readyState).toBe("live");
    expect(container.querySelector(".eye-status")?.textContent).toBe("Loading face model…");
  });

  it("still releases the camera when the step unmounts", async () => {
    const camera = fakeCamera();
    await act(async () => {
      root.render(createElement(EyeStep, { eye: null, onComplete: noop, onSkip: noop, onBack: noop }));
    });
    await skipCalibration();
    await clickAndAcquireCamera(firstTaskButton());
    expect(camera.track.readyState).toBe("live");

    act(() => root.unmount());

    expect(camera.track.readyState).toBe("ended");
  });
});
