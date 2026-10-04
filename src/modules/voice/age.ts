import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import { toMessage } from "../../lib/errors";
import { type VoiceAgeEstimate, voiceAgeEstimateSchema } from "../assessment/types";

export const ageModelStatusSchema = z.object({
  available: z.boolean(),
  mlDir: z.string().nullable().default(null),
  pythonPath: z.string().nullable().default(null),
  pythonVersion: z.string().nullable().default(null),
  modelPath: z.string().nullable().default(null),
  modelPresent: z.boolean(),
  weightsCached: z.boolean(),
  dependenciesOk: z.boolean(),
  missingDependencies: z.array(z.string()).default([]),
  maeYears: z.number(),
  model: z.string(),
  detail: z.string().nullable().default(null),
});
export type AgeModelStatus = z.infer<typeof ageModelStatusSchema>;

const voiceAgeResponseSchema = voiceAgeEstimateSchema.extend({ clipDurationS: z.number() });

const weightsDownloadSchema = z.object({ weightsPath: z.string(), weightsCached: z.boolean() });
export type WeightsDownload = z.infer<typeof weightsDownloadSchema>;

export class AgeModelUnavailableError extends Error {
  readonly code: string;

  constructor(raised: unknown) {
    super(`Voice age model unavailable: ${toMessage(raised)}`);
    this.name = "AgeModelUnavailableError";
    this.code = readCode(raised);
  }
}

function readCode(raised: unknown): string {
  if (typeof raised === "object" && raised !== null && "code" in raised && typeof raised.code === "string") {
    return raised.code;
  }
  return "unknown";
}

const OFFLINE_STATUS: AgeModelStatus = {
  available: false,
  mlDir: null,
  pythonPath: null,
  pythonVersion: null,
  modelPath: null,
  modelPresent: false,
  weightsCached: false,
  dependenciesOk: false,
  missingDependencies: [],
  maeYears: 7.6,
  model: "wavlm-base-plus+svr-voxceleb",
  detail: "Voice age model bridge is unreachable outside the desktop app.",
};

export async function fetchAgeModelStatus(): Promise<AgeModelStatus> {
  try {
    return ageModelStatusSchema.parse(await invoke("age_model_status", {}));
  } catch (raised) {
    return { ...OFFLINE_STATUS, detail: toMessage(raised) || OFFLINE_STATUS.detail };
  }
}

export async function downloadAgeWeights(): Promise<WeightsDownload> {
  try {
    return weightsDownloadSchema.parse(await invoke("age_download_weights", {}));
  } catch (raised) {
    throw new AgeModelUnavailableError(raised);
  }
}

export async function estimateVoiceAge(wav: Uint8Array): Promise<VoiceAgeEstimate> {
  let raw: unknown;
  try {
    raw = await invoke("estimate_voice_age", { wav: Array.from(wav) });
  } catch (raised) {
    throw new AgeModelUnavailableError(raised);
  }
  const parsed = voiceAgeResponseSchema.safeParse(raw);
  if (!parsed.success) throw new AgeModelUnavailableError("unexpected age estimate shape");
  const { ageYears, maeYears, model } = parsed.data;
  return { ageYears, maeYears, model };
}
