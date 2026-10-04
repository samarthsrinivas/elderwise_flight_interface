import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { VoiceLiveVisualizer } from "./VoiceLiveVisualizer";

describe("VoiceLiveVisualizer", () => {
  const dummyWaveformRef = { current: new Float32Array(2048) };

  it("renders recording phase with timer, volume indicator, and hint", () => {
    const html = renderToString(
      <VoiceLiveVisualizer
        phase="recording"
        waveformRef={dummyWaveformRef}
        level={0.25}
        secondsRemaining={6}
        durationS={6}
        estimatesAge={false}
      />,
    );

    expect(html).toContain("00:06");
    expect(html).toContain("voice-viz-ring");
    expect(html).toContain("Good");
    expect(html).toContain("Listening… speak toward your microphone.");
    expect(html).toContain("voice-viz-canvas");
    expect(html).not.toContain("voice-viz-canvas--faded");
    expect(html).not.toContain("Analyzing your voice…");
  });

  it("maps audio level to quiet, good, and loud labels", () => {
    const quietHtml = renderToString(
      <VoiceLiveVisualizer
        phase="recording"
        waveformRef={dummyWaveformRef}
        level={0.03}
        secondsRemaining={5}
        durationS={6}
        estimatesAge={false}
      />,
    );
    expect(quietHtml).toContain("Quiet");

    const loudHtml = renderToString(
      <VoiceLiveVisualizer
        phase="recording"
        waveformRef={dummyWaveformRef}
        level={0.75}
        secondsRemaining={5}
        durationS={6}
        estimatesAge={false}
      />,
    );
    expect(loudHtml).toContain("Loud");
  });

  it("renders analyzing phase without age estimation when estimatesAge is false", () => {
    const html = renderToString(
      <VoiceLiveVisualizer
        phase="analyzing"
        waveformRef={dummyWaveformRef}
        level={0}
        secondsRemaining={0}
        durationS={6}
        estimatesAge={false}
      />,
    );

    expect(html).toContain("00:00");
    expect(html).toContain("voice-viz-canvas--faded");
    expect(html).toContain("Analyzing your voice…");
    expect(html).toContain("Transcribing");
    expect(html).not.toContain("Estimating voice age");
    expect(html).not.toContain("Listening… speak toward your microphone.");
  });

  it("renders analyzing phase with age estimation when estimatesAge is true", () => {
    const html = renderToString(
      <VoiceLiveVisualizer
        phase="analyzing"
        waveformRef={dummyWaveformRef}
        level={0}
        secondsRemaining={0}
        durationS={40}
        estimatesAge={true}
      />,
    );

    expect(html).toContain("00:00");
    expect(html).toContain("Analyzing your voice…");
    expect(html).toContain("Transcribing");
    expect(html).toContain("Estimating voice age");
    expect(html).toContain("role=\"status\"");
  });
});
