import { AiUnavailableError, asrConfigured, transcribe } from "../ai/api";
import type { VoiceAgeEstimate, VoiceTaskId, VoiceTaskResult } from "../assessment/types";
import { estimateVoiceAge } from "./age";
import { analyzeVoiceTask } from "./biomarkers";
import { isMicRecordingSupported, recordWavClip } from "./recordWav";
import { waitForSpeechIdle } from "./speech";
import type { VoiceTaskSpec } from "./tasks";

// The age model was trained on conversational speech; sustained vowels are out of domain.
const AGE_ESTIMATE_TASKS: ReadonlySet<VoiceTaskId> = new Set(["reading-passage", "free-speech"]);

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

async function transcribeIfConfigured(wav: Uint8Array, signal?: AbortSignal): Promise<string> {
  try {
    const configured = await asrConfigured();
    signal?.throwIfAborted();
    return configured ? await transcribe(wav) : "";
  } catch (error) {
    if (!isRecoverableTranscriptError(error)) throw error;
    return "";
  }
}

async function estimateAgeIfSupported(task: VoiceTaskId, wav: Uint8Array): Promise<VoiceAgeEstimate | null> {
  if (!AGE_ESTIMATE_TASKS.has(task)) return null;
  try {
    return await estimateVoiceAge(wav);
  } catch (error) {
    console.warn("voice age estimate skipped:", error);
    return null;
  }
}

export interface CaptureVoiceTaskOptions {
  readonly onLevel?: (rms: number) => void;
  /** Centered time-domain window (-1..1) per animation frame while the mic is open. */
  readonly onWaveform?: (samples: Float32Array) => void;
  /** Fires once the clip is captured and analysis (transcription, voice age) begins. */
  readonly onRecorded?: () => void;
  readonly signal?: AbortSignal;
}

export async function captureVoiceTask(
  spec: VoiceTaskSpec,
  opts: CaptureVoiceTaskOptions = {},
): Promise<VoiceTaskResult> {
  opts.signal?.throwIfAborted();
  await waitForSpeechIdle();
  opts.signal?.throwIfAborted();
  // The recorder owns microphone cleanup and cannot be interrupted; abort at stage boundaries.
  const wav = await recordWavClip(spec.durationS * 1000, {
    ...(opts.onLevel ? { onAudioLevel: opts.onLevel } : {}),
    ...(opts.onWaveform ? { onWaveform: opts.onWaveform } : {}),
  });
  opts.signal?.throwIfAborted();
  opts.onRecorded?.();
  const [transcript, ageEstimate] = await Promise.all([
    transcribeIfConfigured(wav, opts.signal),
    estimateAgeIfSupported(spec.id, wav),
  ]);
  opts.signal?.throwIfAborted();
  return analyzeVoiceTask(spec.id, spec.prompt, transcript, wav, ageEstimate);
}
