// @vitest-environment happy-dom
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { PulseTrace } from "./PulseTrace";
import { VitalsPanel } from "./VitalsPanel";
import type { VitalsCaptureController } from "./useVitalsCapture";

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("PulseTrace component", () => {
  it("renders flat midline and 'Finding your pulse…' when trace is empty and face is detected", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => {
      root.render(createElement(PulseTrace, { trace: [], faceDetected: true }));
    });

    const svg = container.querySelector("svg.vitals-trace-svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toBe("Waiting for pulse signal");
    expect(container.querySelector("line.vitals-trace-midline")).not.toBeNull();
    expect(container.textContent).toContain("Finding your pulse…");
  });

  it("renders 'Hold still, face not detected' when trace is empty and face is not detected", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => {
      root.render(createElement(PulseTrace, { trace: [], faceDetected: false }));
    });

    expect(container.textContent).toContain("Hold still, face not detected");
    const svg = container.querySelector("svg.vitals-trace-svg");
    expect(svg?.getAttribute("aria-label")).toBe("Waiting for pulse signal");
  });

  it("renders an SVG path across the full width when trace has points", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const trace = [0, 0.5, 1, 0, -0.5, -1, 0];
    act(() => {
      root.render(createElement(PulseTrace, { trace, faceDetected: true }));
    });

    const path = container.querySelector("path.vitals-trace-path");
    expect(path).not.toBeNull();
    expect(path?.getAttribute("stroke")).toBe("var(--color-accent)");
    expect(path?.getAttribute("stroke-width")).toBe("2.5");
    expect(path?.getAttribute("vector-effect")).toBe("non-scaling-stroke");
    expect(container.querySelector(".vitals-trace-badge")?.textContent).toBe("Live");
  });
});

describe("VitalsPanel live capture visualization", () => {
  function makeMockController(overrides: Partial<VitalsCaptureController> = {}): VitalsCaptureController {
    return {
      phase: "capturing",
      progress: 0.4,
      elapsedS: 12.3,
      liveBpm: 72,
      liveSnr: 4.5,
      pulseTrace: [0, 0.2, 0.8, -0.4, 0],
      faceDetected: true,
      result: null,
      error: null,
      videoRef: { current: null },
      start: async () => {},
      cancel: () => {},
      ...overrides,
    };
  }

  it("renders live BPM, pulsing heart icon, signal quality, and progress ring during capturing", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const controller = makeMockController({ liveBpm: 75, liveSnr: 4.2 });

    act(() => {
      root.render(createElement(VitalsPanel, { controller }));
    });

    // BPM readout and heart icon
    const bpmVal = container.querySelector(".vitals-bpm-value");
    expect(bpmVal?.textContent).toBe("75");
    const heart = container.querySelector("svg.vitals-heart-icon");
    expect(heart).not.toBeNull();
    expect(heart?.classList.contains("is-pulsing")).toBe(true);
    expect(heart?.getAttribute("style")).toContain("animation-duration: 0.80s");
    expect(container.textContent).toContain("beats per minute (live)");

    // Signal quality pill
    const snrPill = container.querySelector(".vitals-snr-pill");
    expect(snrPill?.textContent).toContain("Good signal");
    expect(snrPill?.classList.contains("vitals-snr-pill--good")).toBe(true);

    // Progress ring
    const progress = container.querySelector(".vitals-progress");
    expect(progress?.getAttribute("role")).toBe("progressbar");
    expect(progress?.getAttribute("aria-valuenow")).toBe("40");
    expect(container.textContent).toContain("12s / 30s");
    expect(container.querySelector(".vitals-progress-ring-rail")).not.toBeNull();

    // Pulse trace
    expect(container.querySelector(".vitals-trace-svg")).not.toBeNull();
  });

  it("handles null liveBpm, negative liveSnr, and weak liveSnr gracefully", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const controller = makeMockController({
      liveBpm: null,
      liveSnr: -1.2,
      pulseTrace: [],
      faceDetected: false,
    });

    act(() => {
      root.render(createElement(VitalsPanel, { controller }));
    });

    // BPM is "--" and heart is not pulsing
    expect(container.querySelector(".vitals-bpm-value")?.textContent).toBe("--");
    const heart = container.querySelector("svg.vitals-heart-icon");
    expect(heart?.classList.contains("is-pulsing")).toBe(false);

    // SNR Searching
    const snrPill = container.querySelector(".vitals-snr-pill");
    expect(snrPill?.textContent).toContain("Searching");
    expect(snrPill?.classList.contains("vitals-snr-pill--searching")).toBe(true);

    // PulseTrace shows face not detected
    expect(container.textContent).toContain("Hold still, face not detected");
  });

  it("renders Weak signal when liveSnr is between 0 and 3", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const controller = makeMockController({ liveSnr: 1.5 });

    act(() => {
      root.render(createElement(VitalsPanel, { controller }));
    });

    const snrPill = container.querySelector(".vitals-snr-pill");
    expect(snrPill?.textContent).toContain("Weak signal");
    expect(snrPill?.classList.contains("vitals-snr-pill--weak")).toBe(true);
  });
});
