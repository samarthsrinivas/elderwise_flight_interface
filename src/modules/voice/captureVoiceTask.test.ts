import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiUnavailableError, asrConfigured, transcribe } from "../ai/api";
import { AgeModelUnavailableError, estimateVoiceAge } from "./age";
import { captureVoiceTask } from "./captureVoiceTask";
import { encodeWav, recordWavClip } from "./recordWav";
import { sine, SAMPLE_RATE } from "./syntheticSignals";
import { voiceTaskSpec } from "./tasks";

vi.mock("../ai/api", () => ({
  AiUnavailableError: class AiUnavailableError extends Error {},
  asrConfigured: vi.fn(),
  transcribe: vi.fn(),
}));
vi.mock("./age", () => ({
  AgeModelUnavailableError: class AgeModelUnavailableError extends Error {},
  estimateVoiceAge: vi.fn(),
}));
vi.mock("./speech", () => ({ waitForSpeechIdle: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./recordWav", async (importOriginal) => ({
  ...await importOriginal<typeof import("./recordWav")>(),
  recordWavClip: vi.fn(),
}));

const AGE = { ageYears: 63.4, maeYears: 7.6, model: "wavlm-base-plus+svr-voxceleb" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(recordWavClip).mockResolvedValue(encodeWav(sine(), SAMPLE_RATE));
  vi.mocked(asrConfigured).mockResolvedValue(true);
  vi.mocked(transcribe).mockResolvedValue("Yesterday I walked to the park.");
  vi.mocked(estimateVoiceAge).mockResolvedValue(AGE);
});

describe("voice task capture", () => {
  it("records the requested duration and returns local markers when ASR succeeds", async () => {
    const spec = voiceTaskSpec("free-speech");
    const onLevel = vi.fn();
    const result = await captureVoiceTask(spec, { onLevel });
    expect(recordWavClip).toHaveBeenCalledWith(30000, { onAudioLevel: onLevel });
    expect(result.task).toBe("free-speech");
    expect(result.transcript).toBe("Yesterday I walked to the park.");
    expect(result.markers.f0MeanHz).toBeCloseTo(150, 0);
    expect(result.ageEstimate).toEqual(AGE);
  });

  it("skips the age model for sustained vowels", async () => {
    const result = await captureVoiceTask(voiceTaskSpec("sustained-vowel"));
    expect(estimateVoiceAge).not.toHaveBeenCalled();
    expect(result.ageEstimate).toBeNull();
  });

  it("keeps transcript and markers when the age model is unavailable", async () => {
    vi.mocked(estimateVoiceAge).mockRejectedValue(new AgeModelUnavailableError("model_missing"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await captureVoiceTask(voiceTaskSpec("reading-passage"));
    expect(result.ageEstimate).toBeNull();
    expect(result.transcript).toBe("Yesterday I walked to the park.");
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("keeps local markers when ASR is disabled", async () => {
    vi.mocked(asrConfigured).mockResolvedValue(false);
    const result = await captureVoiceTask(voiceTaskSpec("sustained-vowel"));
    expect(result.transcript).toBe("");
    expect(result.markers.f0MeanHz).toBeCloseTo(150, 0);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("keeps local markers when the ASR provider is unavailable", async () => {
    vi.mocked(transcribe).mockRejectedValue(new AiUnavailableError("offline"));
    const result = await captureVoiceTask(voiceTaskSpec("reading-passage"));
    expect(result.transcript).toBe("");
    expect(result.capture.quality).toBe("good");
  });

  it("keeps local markers when ASR configuration lookup fails", async () => {
    vi.mocked(asrConfigured).mockRejectedValue(new AiUnavailableError("offline"));
    const result = await captureVoiceTask(voiceTaskSpec("reading-passage"));
    expect(result.transcript).toBe("");
    expect(result.markers.f0MeanHz).toBeCloseTo(150, 0);
  });

  it("propagates a permission error even when wrapped by the AI bridge", async () => {
    const error = new AiUnavailableError("Permission denied");
    vi.mocked(transcribe).mockRejectedValue(error);
    await expect(captureVoiceTask(voiceTaskSpec("free-speech"))).rejects.toBe(error);
  });

  it("propagates microphone permission denial before trying ASR", async () => {
    const error = new DOMException("", "NotAllowedError");
    vi.mocked(recordWavClip).mockRejectedValue(error);
    await expect(captureVoiceTask(voiceTaskSpec("free-speech"))).rejects.toBe(error);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("propagates unexpected implementation errors instead of hiding them", async () => {
    const error = new TypeError("invalid implementation");
    vi.mocked(transcribe).mockRejectedValue(error);
    await expect(captureVoiceTask(voiceTaskSpec("free-speech"))).rejects.toBe(error);
  });

  it("avoids recording when already aborted", async () => {
    const signal = AbortSignal.abort();
    await expect(captureVoiceTask(voiceTaskSpec("sustained-vowel"), { signal })).rejects.toHaveProperty("name", "AbortError");
    expect(recordWavClip).not.toHaveBeenCalled();
  });

  it("avoids uploading audio when aborted during recording", async () => {
    const controller = new AbortController();
    vi.mocked(recordWavClip).mockImplementation(async () => {
      controller.abort();
      return encodeWav(sine(), SAMPLE_RATE);
    });
    await expect(captureVoiceTask(voiceTaskSpec("sustained-vowel"), { signal: controller.signal })).rejects.toHaveProperty("name", "AbortError");
    expect(transcribe).not.toHaveBeenCalled();
  });
});
