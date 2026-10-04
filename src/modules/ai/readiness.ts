import type { AiStatus, AsrProvider } from "./types";

export interface AiReadiness {
  recommendedAsrProvider: AsrProvider;
  speechToTextReady: boolean;
  voiceOutputReady: boolean;
  summaryReady: boolean;
  speechToTextMessage: string;
  summaryMessage: string;
  voiceOutputMessage: string;
}

export function buildAiReadiness(status: AiStatus): AiReadiness {
  const speechToTextReady = status.asr.configured;
  const summaryReady = status.chat.configured;
  // System voice is always available, or ElevenLabs if configured
  const voiceOutputReady =
    status.voice.provider === "system" ? true : status.voice.configured;

  const speechToTextMessage = speechToTextReady
    ? "Speech-to-text is ready for spoken answers."
    : status.asr.provider === "off"
      ? "Speech-to-text is turned off."
      : `Speech-to-text requires a valid ${status.asr.provider === "elevenlabs" ? "ElevenLabs" : "OpenAI"} API key.`;

  const summaryMessage = summaryReady
    ? "AI summary generation is ready."
    : status.chat.provider === "off"
      ? "AI summary generation is turned off."
      : "AI summaries require a valid OpenAI API key.";

  const voiceOutputMessage =
    status.voice.provider === "elevenlabs" && status.voice.configured
      ? "Voice output is ready using ElevenLabs."
      : status.voice.provider === "elevenlabs" && !status.voice.configured
        ? "ElevenLabs voice output requires an API key (falling back to system voice)."
        : "Voice output is ready using the device's system voice.";

  return {
    recommendedAsrProvider: "elevenlabs",
    speechToTextReady,
    voiceOutputReady,
    summaryReady,
    speechToTextMessage,
    summaryMessage,
    voiceOutputMessage,
  };
}
