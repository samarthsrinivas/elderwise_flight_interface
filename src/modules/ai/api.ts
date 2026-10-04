import { invoke } from "@tauri-apps/api/core";
import { toMessage } from "../../lib/errors";
import type { AssessmentSession } from "../assessment/types";
import {
  type AiSettings,
  type AiStatus,
  type KeyProvider,
  type TestableProvider,
  type TestResult,
  aiSettingsSchema,
  aiStatusSchema,
  defaultAiSettings,
  testResultSchema,
} from "./types";

/** Raised when an AI bridge command is unreachable or the response is malformed. */
export class AiUnavailableError extends Error {
  constructor(cause: string) {
    super(`AI provider unavailable: ${cause}`);
    this.name = "AiUnavailableError";
  }
}

const OFFLINE_STATUS: AiStatus = {
  asr: {
    provider: "elevenlabs",
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
  voice: {
    provider: "system",
    configured: true,
    source: "local",
    model: "System voice",
  },
  keys: {
    openai: { configured: false, source: "none" },
    elevenlabs: { configured: false, source: "none" },
  },
};

/** Per-capability provider status; safe outside a Tauri window. */
export async function fetchAiStatus(): Promise<AiStatus> {
  try {
    return aiStatusSchema.parse(await invoke("ai_status", {}));
  } catch {
    return OFFLINE_STATUS;
  }
}

/** True when the configured transcription provider is usable. */
export async function asrConfigured(): Promise<boolean> {
  return (await fetchAiStatus()).asr.configured;
}

export async function getAiSettings(): Promise<AiSettings> {
  try {
    return aiSettingsSchema.parse(await invoke("ai_get_settings", {}));
  } catch (raised) {
    // If running in development/browser mock mode, return default settings
    if (toMessage(raised).includes("invoke")) {
      return defaultAiSettings();
    }
    throw new AiUnavailableError(toMessage(raised));
  }
}

export async function setAiSettings(next: AiSettings): Promise<AiSettings> {
  try {
    return aiSettingsSchema.parse(await invoke("ai_set_settings", { next }));
  } catch (raised) {
    throw new AiUnavailableError(toMessage(raised));
  }
}

export async function setProviderKey(
  provider: KeyProvider,
  key: string,
): Promise<void> {
  try {
    await invoke("ai_set_key", { provider, key });
  } catch (raised) {
    throw new AiUnavailableError(toMessage(raised));
  }
}

export async function clearProviderKey(provider: KeyProvider): Promise<void> {
  try {
    await invoke("ai_clear_key", { provider });
  } catch (raised) {
    throw new AiUnavailableError(toMessage(raised));
  }
}

export async function testProvider(
  provider: TestableProvider,
): Promise<TestResult> {
  try {
    return testResultSchema.parse(await invoke("ai_test", { provider }));
  } catch (raised) {
    throw new AiUnavailableError(toMessage(raised));
  }
}

/** Transcribe a WAV clip via the configured ASR provider (Rust proxy). */
export async function transcribe(wav: Uint8Array): Promise<string> {
  let raw: unknown;
  try {
    raw = await invoke("transcribe_audio", { wav: Array.from(wav) });
  } catch (raised) {
    throw new AiUnavailableError(toMessage(raised));
  }
  if (typeof raw !== "string") {
    throw new AiUnavailableError("unexpected transcript type");
  }
  return raw;
}

/** Synthesize speech through the configured cloud voice provider. */
export async function synthesizeSpeech(
  text: string,
  _lang?: string,
): Promise<Uint8Array> {
  let raw: unknown;
  try {
    raw = await invoke("synthesize_speech", { text });
  } catch (raised) {
    throw new AiUnavailableError(toMessage(raised));
  }
  if (!Array.isArray(raw) || !raw.every((item) => Number.isInteger(item))) {
    throw new AiUnavailableError("unexpected speech audio type");
  }
  return Uint8Array.from(raw);
}

/** Generate an assessment summary via the configured chat provider. */
export async function summarizeAssessment(
  results: AssessmentSession,
): Promise<string> {
  let raw: unknown;
  try {
    raw = await invoke("summarize_assessment", { results });
  } catch (raised) {
    throw new AiUnavailableError(toMessage(raised));
  }
  if (typeof raw !== "string") {
    throw new AiUnavailableError("unexpected summary type");
  }
  return raw;
}
