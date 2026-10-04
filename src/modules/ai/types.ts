import { z } from "zod";

export const asrProviderSchema = z.enum(["elevenlabs", "openai", "off"]);
export const chatProviderSchema = z.enum(["openai", "off"]);
export const voiceProviderSchema = z.enum(["elevenlabs", "system"]);

export type AsrProvider = z.infer<typeof asrProviderSchema>;
export type ChatProvider = z.infer<typeof chatProviderSchema>;
export type VoiceProvider = z.infer<typeof voiceProviderSchema>;

export const keyProviderSchema = z.enum(["openai", "elevenlabs"]);
export type KeyProvider = z.infer<typeof keyProviderSchema>;

/** Providers that can be probed via ai_test */
export type TestableProvider = KeyProvider;

export const aiSettingsSchema = z.object({
  asrProvider: asrProviderSchema,
  chatProvider: chatProviderSchema,
  voiceProvider: voiceProviderSchema,
  elevenlabsVoiceId: z.string(),
  elevenlabsTtsModel: z.string(),
  elevenlabsAsrModel: z.string(),
  openaiAsrModel: z.string(),
  openaiChatModel: z.string(),
});
export type AiSettings = z.infer<typeof aiSettingsSchema>;

export function defaultAiSettings(): AiSettings {
  return {
    asrProvider: "elevenlabs",
    chatProvider: "openai",
    voiceProvider: "elevenlabs",
    elevenlabsVoiceId: "JBFqnCBsd6RMkjVDRZzb",
    elevenlabsTtsModel: "eleven_v4",
    elevenlabsAsrModel: "scribe_v2",
    openaiAsrModel: "gpt-4o-mini-transcribe",
    openaiChatModel: "gpt-6.1-sol",
  };
}

export const keySourceSchema = z.enum(["keychain", "env", "local", "none"]);
export type KeySource = z.infer<typeof keySourceSchema>;

export const keyStatusSchema = z.object({
  configured: z.boolean(),
  source: keySourceSchema,
});
export type KeyStatus = z.infer<typeof keyStatusSchema>;

export const providerStatusSchema = z.object({
  provider: z.string(),
  configured: z.boolean(),
  source: keySourceSchema,
  model: z.string().nullable(),
});
export type ProviderStatus = z.infer<typeof providerStatusSchema>;

export const aiStatusSchema = z.object({
  asr: providerStatusSchema,
  chat: providerStatusSchema,
  voice: providerStatusSchema,
  keys: z.object({
    openai: keyStatusSchema,
    elevenlabs: keyStatusSchema,
  }),
});
export type AiStatus = z.infer<typeof aiStatusSchema>;

export const testResultSchema = z.object({
  ok: z.boolean(),
  detail: z.string(),
  models: z.array(z.string()),
});
export type TestResult = z.infer<typeof testResultSchema>;
