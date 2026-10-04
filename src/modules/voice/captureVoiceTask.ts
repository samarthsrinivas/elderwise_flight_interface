import { AiUnavailableError, asrConfigured, transcribe } from "../ai/api";
import type { VoiceTaskResult } from "../assessment/types";
import { analyzeVoiceTask } from "./biomarkers";
import { isMicRecordingSupported, recordWavClip } from "./recordWav";
import { waitForSpeechIdle } from "./speech";
import type { VoiceTaskSpec } from "./tasks";

export function isVoiceInputSupported(): boolean {
  return isMicRecordingSupported();
}

export function isPermissionTranscriptError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /not.?allowed|service-not-allowed|permission|denied/i.test(message);
}

export function isRecoverableTranscriptError(error: unknown): boolean {
  if (isPermissionTranscriptError(error)) return false;
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return error instanceof AiUnavailableError || /no speech detected|no-speech|aborted|network|timeout|timed out/i.test(message);
}

export async function captureVoiceTask(
  spec: VoiceTaskSpec,
  opts: { readonly onLevel?: (rms: number) => void; readonly signal?: AbortSignal } = {},
): Promise<VoiceTaskResult> {
  opts.signal?.throwIfAborted();
  await waitForSpeechIdle();
  opts.signal?.throwIfAborted();
  // The recorder owns microphone cleanup and cannot be interrupted; abort at stage boundaries.
  const wav = await recordWavClip(spec.durationS * 1000, opts.onLevel ? { onAudioLevel: opts.onLevel } : {});
  opts.signal?.throwIfAborted();
  let transcript = "";
  try {
    const configured = await asrConfigured();
    opts.signal?.throwIfAborted();
    if (configured) transcript = await transcribe(wav);
  } catch (error) {
    if (!isRecoverableTranscriptError(error)) throw error;
    transcript = "";
  }
  opts.signal?.throwIfAborted();
  return analyzeVoiceTask(spec.id, spec.prompt, transcript, wav);
}
