import { describe, expect, it } from "vitest";
import { summarizeAiStatus } from "./statusSummary";
import type { AiStatus } from "./types";

const configuredStatus: AiStatus = {
  asr: {
    provider: "elevenlabs",
    configured: true,
    source: "keychain",
    model: "scribe_v2",
  },
  chat: {
    provider: "openai",
    configured: true,
    source: "env",
    model: "gpt-6.1-sol",
  },
  voice: {
    provider: "system",
    configured: true,
    source: "local",
    model: null,
  },
  keys: {
    openai: { configured: true, source: "env" },
    elevenlabs: { configured: true, source: "keychain" },
  },
};

describe("AI active status summary", () => {
  it("marks configured selected providers as active", () => {
    expect(summarizeAiStatus(configuredStatus)).toEqual([
      {
        id: "asr",
        name: "Transcription",
        provider: "ElevenLabs",
        source: "keychain",
        state: "active",
        details: ["Model: scribe_v2"],
      },
      {
        id: "chat",
        name: "Summary",
        provider: "OpenAI",
        source: "env",
        state: "active",
        details: ["Model: gpt-6.1-sol"],
      },
      {
        id: "voice",
        name: "Voice Output",
        provider: "System Voice",
        source: "local",
        state: "active",
        details: [],
      },
    ]);
  });

  it("handles needs_setup and off states", () => {
    const unconfigured: AiStatus = {
      ...configuredStatus,
      asr: {
        provider: "off",
        configured: false,
        source: "none",
        model: null,
      },
      chat: {
        provider: "openai",
        configured: false,
        source: "none",
        model: null,
      },
    };
    const summary = summarizeAiStatus(unconfigured);
    expect(summary[0]?.state).toBe("off");
    expect(summary[1]?.state).toBe("needs_setup");
  });
});
