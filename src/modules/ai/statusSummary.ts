import type { AiStatus, KeySource } from "./types";

export type AiCapabilityId = "asr" | "chat" | "voice";
export type AiCapabilityState = "active" | "needs_setup" | "off";

export interface AiCapabilitySummary {
  id: AiCapabilityId;
  name: string;
  provider: string;
  source: KeySource;
  state: AiCapabilityState;
  details: string[];
}

const PROVIDER_NAMES: Record<string, string> = {
  elevenlabs: "ElevenLabs",
  openai: "OpenAI",
  system: "System Voice",
  off: "Off",
};

export function summarizeAiStatus(status: AiStatus): AiCapabilitySummary[] {
  const asrState: AiCapabilityState =
    status.asr.provider === "off"
      ? "off"
      : status.asr.configured
        ? "active"
        : "needs_setup";

  const chatState: AiCapabilityState =
    status.chat.provider === "off"
      ? "off"
      : status.chat.configured
        ? "active"
        : "needs_setup";

  const voiceState: AiCapabilityState =
    status.voice.provider === "system"
      ? "active"
      : status.voice.configured
        ? "active"
        : "needs_setup";

  return [
    {
      id: "asr",
      name: "Transcription",
      provider: PROVIDER_NAMES[status.asr.provider] ?? status.asr.provider,
      source: status.asr.source,
      state: asrState,
      details: status.asr.model ? [`Model: ${status.asr.model}`] : [],
    },
    {
      id: "chat",
      name: "Summary",
      provider: PROVIDER_NAMES[status.chat.provider] ?? status.chat.provider,
      source: status.chat.source,
      state: chatState,
      details: status.chat.model ? [`Model: ${status.chat.model}`] : [],
    },
    {
      id: "voice",
      name: "Voice Output",
      provider: PROVIDER_NAMES[status.voice.provider] ?? status.voice.provider,
      source: status.voice.source,
      state: voiceState,
      details: status.voice.model ? [`Model: ${status.voice.model}`] : [],
    },
  ];
}
