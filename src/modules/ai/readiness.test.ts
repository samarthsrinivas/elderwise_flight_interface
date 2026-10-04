import { describe, expect, it } from "vitest";
import { buildAiReadiness } from "./readiness";
import type { AiStatus } from "./types";

const baseStatus: AiStatus = {
  asr: {
    provider: "elevenlabs",
    configured: true,
    source: "keychain",
    model: "scribe_v1",
  },
  chat: {
    provider: "openai",
    configured: true,
    source: "keychain",
    model: "gpt-5.5",
  },
  voice: {
    provider: "system",
    configured: true,
    source: "local",
    model: null,
  },
  keys: {
    openai: { configured: true, source: "keychain" },
    elevenlabs: { configured: true, source: "keychain" },
  },
};

describe("buildAiReadiness", () => {
  it("marks speechToText and summary ready when configured", () => {
    const readiness = buildAiReadiness(baseStatus);
    expect(readiness.speechToTextReady).toBe(true);
    expect(readiness.summaryReady).toBe(true);
    expect(readiness.voiceOutputReady).toBe(true);
  });

  it("handles unconfigured ASR", () => {
    const unconfiguredAsr: AiStatus = {
      ...baseStatus,
      asr: {
        provider: "elevenlabs",
        configured: false,
        source: "none",
        model: null,
      },
    };
    const readiness = buildAiReadiness(unconfiguredAsr);
    expect(readiness.speechToTextReady).toBe(false);
    expect(readiness.speechToTextMessage).toContain("ElevenLabs");
  });

  it("handles off states", () => {
    const offStatus: AiStatus = {
      ...baseStatus,
      asr: {
        provider: "off",
        configured: false,
        source: "none",
        model: null,
      },
      chat: {
        provider: "off",
        configured: false,
        source: "none",
        model: null,
      },
    };
    const readiness = buildAiReadiness(offStatus);
    expect(readiness.speechToTextMessage).toContain("turned off");
    expect(readiness.summaryMessage).toContain("turned off");
  });
});
