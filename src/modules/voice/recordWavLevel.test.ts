import { describe, expect, it } from "vitest";
import source from "./recordWav.ts?raw";

describe("microphone level meter on iOS", () => {
  it("resumes the AudioContext it creates", () => {
    // On iOS a new AudioContext starts suspended and never renders until
    // resumed. Without this the analyser reads a flat 128 for the whole clip
    // and the meter shows silence while the participant is speaking.
    expect(source).toMatch(/levelContext\.resume\(\)/);
  });

  it("does not let a failed resume take the recording down with it", () => {
    // resume() rejects without a user gesture in scope, and the questionnaire
    // auto-listens after a TTS round trip. A dead meter must not fail capture.
    expect(source).toMatch(/resume\(\)\s*\.catch\(/);
  });
});
