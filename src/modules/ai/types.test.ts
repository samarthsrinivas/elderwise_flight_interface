import { describe, expect, it } from "vitest";
import { defaultAiSettings, aiSettingsSchema, aiStatusSchema, testResultSchema } from "./types";

describe("ai schemas", () => {
  it("parses default settings", () => {
    const defaults = defaultAiSettings();
    const parsed = aiSettingsSchema.parse(defaults);
    expect(parsed.asrProvider).toBe("elevenlabs");
    expect(parsed.chatProvider).toBe("openai");
    expect(parsed.voiceProvider).toBe("elevenlabs");
    expect(parsed.elevenlabsVoiceId).toBe("JBFqnCBsd6RMkjVDRZzb");
  });

  it("rejects unknown providers", () => {
    expect(
      aiSettingsSchema.safeParse({
        asrProvider: "whisper",
        chatProvider: "off",
        voiceProvider: "system",
        elevenlabsVoiceId: "",
        elevenlabsTtsModel: "",
        elevenlabsAsrModel: "",
        openaiAsrModel: "",
        openaiChatModel: "",
      }).success,
    ).toBe(false);
  });

  it("parses valid status object", () => {
    const status = {
      asr: {
        provider: "elevenlabs",
        configured: true,
        source: "keychain",
        model: "scribe_v1",
      },
      chat: {
        provider: "openai",
        configured: true,
        source: "env",
        model: "gpt-5.5",
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
    const parsed = aiStatusSchema.parse(status);
    expect(parsed.asr.configured).toBe(true);
    expect(parsed.chat.source).toBe("env");
  });

  it("parses test result schema", () => {
    const testRes = {
      ok: true,
      detail: "Connected successfully",
      models: ["gpt-4o", "gpt-5.5"],
    };
    const parsed = testResultSchema.parse(testRes);
    expect(parsed.ok).toBe(true);
    expect(parsed.models).toHaveLength(2);
  });
});
