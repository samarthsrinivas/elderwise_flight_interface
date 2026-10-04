import { describe, expect, it } from "vitest";
import { voiceResultSchema, voiceTaskResultSchema } from "../assessment/types";
import {
  aggregateVoiceResult, analyzeVoiceTask, computeCaptureQuality,
  emptyVoiceMarkers, parseWavPcm16, voiceBand,
} from "./biomarkers";
import { encodeWav } from "./recordWav";
import { SAMPLE_RATE, sine, perturbedSine, speechBursts } from "./syntheticSignals";

describe("local acoustic analysis", () => {
  it("measures a steady 150 Hz vowel when the capture is periodic", () => {
    const wav = encodeWav(sine(), SAMPLE_RATE);
    const { markers } = analyzeVoiceTask("sustained-vowel", "ahh", "", wav);
    expect(markers.f0MeanHz).toBeCloseTo(150, 0);
    expect(markers.jitterPct).toBeLessThan(0.3);
    expect(markers.shimmerPct).toBeLessThan(0.5);
    expect(markers.hnrDb).toBeGreaterThan(25);
    expect(markers.voicedRatio).toBeGreaterThan(0.9);
  });

  it("detects jitter when periods have random three-percent perturbations", () => {
    const wav = encodeWav(perturbedSine({ periodVariation: 0.03 }), SAMPLE_RATE);
    const { markers } = analyzeVoiceTask("sustained-vowel", "ahh", "", wav);
    expect(markers.jitterPct).toBeGreaterThan(1);
  });

  it("detects shimmer when cycle amplitudes vary by ten percent", () => {
    const wav = encodeWav(perturbedSine({ amplitudeVariation: 0.1 }), SAMPLE_RATE);
    const { markers } = analyzeVoiceTask("sustained-vowel", "ahh", "", wav);
    expect(markers.shimmerPct).toBeGreaterThan(3);
  });

  it("estimates HNR when the vowel has 10 dB white noise", () => {
    const wav = encodeWav(perturbedSine({ noiseSnrDb: 10 }), SAMPLE_RATE);
    const { markers } = analyzeVoiceTask("sustained-vowel", "ahh", "", wav);
    expect(markers.hnrDb).toBeGreaterThan(5);
    expect(markers.hnrDb).toBeLessThan(15);
  });

  it("reports unvoiced poor capture when the clip is silent", () => {
    const wav = encodeWav(new Float32Array(2 * SAMPLE_RATE), SAMPLE_RATE);
    const result = analyzeVoiceTask("sustained-vowel", "ahh", "", wav);
    expect(result.markers.f0MeanHz).toBeNull();
    expect(result.markers.voicedRatio).toBe(0);
    expect(result.capture.quality).toBe("poor");
  });

  it("counts nuclei and only the internal long pause when speech has short gaps", () => {
    const wav = encodeWav(speechBursts(), SAMPLE_RATE);
    const { markers, capture } = analyzeVoiceTask("reading-passage", "read", "", wav);
    expect((markers.speechRateSylPerS ?? 0) * capture.durationS).toBeGreaterThanOrEqual(8);
    expect((markers.speechRateSylPerS ?? 0) * capture.durationS).toBeLessThanOrEqual(12);
    expect(markers.pauseCount).toBe(1);
    expect(markers.pauseRatio).toBeCloseTo(0.1, 1);
    expect(markers.articulationRateSylPerS).toBeGreaterThan(markers.speechRateSylPerS ?? 0);
  });

  it("rejects capture quality when a square wave clips", () => {
    const samples = sine().map((sample) => sample >= 0 ? 1 : -1);
    const result = analyzeVoiceTask("sustained-vowel", "ahh", "", encodeWav(samples, SAMPLE_RATE));
    expect(result.capture.clippingRatio).toBeGreaterThan(0.02);
    expect(result.capture.quality).toBe("poor");
  });

  it("returns a schema-valid unavailable task when WAV bytes are garbage", () => {
    const result = analyzeVoiceTask("free-speech", "yesterday", "", new Uint8Array([1, 2, 3]));
    expect(voiceTaskResultSchema.parse(result).capture.quality).toBe("unavailable");
    expect(result.markers).toEqual(emptyVoiceMarkers());
  });

  it("withholds pitch statistics when fewer than five frames are voiced", () => {
    const result = analyzeVoiceTask("sustained-vowel", "ahh", "", encodeWav(sine(0.06), SAMPLE_RATE));
    expect(result.markers.f0MeanHz).toBeNull();
    expect(result.markers.f0SdHz).toBeNull();
    expect(result.capture.quality).toBe("unavailable");
  });
});

describe("capture quality", () => {
  it.each([
    [0.4, 0.5, "unavailable"], [2, 0.003, "poor"],
    [2, 0.023, "fair"], [2, 0.5, "good"],
  ] as const)("classifies duration %s and amplitude %s as %s", (duration, amplitude, quality) => {
    const samples = sine(duration).map((sample) => sample * amplitude / 0.5);
    const capture = computeCaptureQuality(samples, SAMPLE_RATE);
    expect(capture.quality).toBe(quality);
  });
});

describe("voice summaries", () => {
  it("selects vowel pitch and averages spoken-task rates when all tasks exist", () => {
    const base = analyzeVoiceTask("sustained-vowel", "ahh", "", encodeWav(sine(), SAMPLE_RATE));
    const tasks = [base, {
      ...base, task: "reading-passage" as const,
      markers: { ...base.markers, f0MeanHz: 200, speechRateSylPerS: 3, pauseRatio: 0.2, pauseCount: 2 },
    }, {
      ...base, task: "free-speech" as const,
      markers: { ...base.markers, f0MeanHz: 250, speechRateSylPerS: 5, pauseRatio: 0.4, pauseCount: 4 },
    }];
    const result = aggregateVoiceResult(tasks);
    expect(result.markers.f0MeanHz).toBe(base.markers.f0MeanHz);
    expect(result.markers.speechRateSylPerS).toBe(4);
    expect(result.markers.pauseRatio).toBeCloseTo(0.3);
    expect(result.markers.pauseCount).toBe(3);
    expect(voiceResultSchema.parse(result)).toEqual(result);
  });

  it("averages available pitch when no vowel task exists", () => {
    const base = analyzeVoiceTask("reading-passage", "read", "", encodeWav(sine(), SAMPLE_RATE));
    const result = aggregateVoiceResult([base, { ...base, markers: { ...base.markers, f0MeanHz: 250 } }]);
    expect(result.markers.f0MeanHz).toBeCloseTo(200, 0);
  });

  it("retains the worst quality when one task is unavailable", () => {
    const good = analyzeVoiceTask("reading-passage", "read", "", encodeWav(sine(), SAMPLE_RATE));
    const missing = analyzeVoiceTask("free-speech", "cue", "", new Uint8Array());
    const result = aggregateVoiceResult([good, missing]);
    expect(result.quality).toBe("unavailable");
    expect(result.band).toBe("limited");
  });

  it("returns an unavailable schema-valid summary when tasks are absent", () => {
    const result = aggregateVoiceResult([]);
    expect(voiceResultSchema.parse(result).quality).toBe("unavailable");
    expect(result.markers).toEqual(emptyVoiceMarkers());
    expect(result.age).toBeNull();
  });

  it("averages voice-age estimates across the tasks that produced one", () => {
    const wav = encodeWav(sine(), SAMPLE_RATE);
    const model = "wavlm-base-plus+svr-voxceleb";
    const tasks = [
      analyzeVoiceTask("sustained-vowel", "ahh", "", wav),
      analyzeVoiceTask("reading-passage", "read", "", wav, { ageYears: 61.2, maeYears: 7.6, model }),
      analyzeVoiceTask("free-speech", "cue", "", wav, { ageYears: 66.7, maeYears: 7.6, model }),
    ];
    const result = aggregateVoiceResult(tasks);
    expect(result.age).toEqual({
      ageYears: 64, maeYears: 7.6, model,
      tasks: [{ task: "reading-passage", ageYears: 61.2 }, { task: "free-speech", ageYears: 66.7 }],
    });
    expect(voiceResultSchema.parse(result)).toEqual(result);
  });

  it("parses history written before age estimates existed", () => {
    const legacyTask = analyzeVoiceTask("free-speech", "cue", "", encodeWav(sine(), SAMPLE_RATE));
    const { ageEstimate: _dropped, ...withoutAge } = legacyTask;
    expect(voiceTaskResultSchema.parse(withoutAge).ageEstimate).toBeNull();
    const { age: _droppedAge, ...legacyResult } = aggregateVoiceResult([legacyTask]);
    expect(voiceResultSchema.parse(legacyResult).age).toBeNull();
  });

  it.each([
    [{}, "good"], [{ jitterPct: 2 }, "moderate"],
    [{ jitterPct: 2, shimmerPct: 6 }, "limited"],
  ] as const)("bands available markers %j as %s", (values, expected) => {
    const markers = { ...emptyVoiceMarkers(), ...values };
    expect(voiceBand(markers, "good")).toBe(expected);
  });
});

describe("PCM boundary", () => {
  it("averages stereo channels when a PCM WAV has two channels", () => {
    const wav = encodeWav(new Float32Array([0.5, -0.5, 0.25, 0.75]), SAMPLE_RATE);
    const view = new DataView(wav.buffer);
    view.setUint16(22, 2, true);
    view.setUint16(32, 4, true);
    view.setUint32(28, SAMPLE_RATE * 4, true);
    const parsed = parseWavPcm16(wav);
    expect(parsed?.sampleRate).toBe(SAMPLE_RATE);
    expect(parsed?.samples.length).toBe(2);
    expect(parsed?.samples[0]).toBeCloseTo(0, 4);
    expect(parsed?.samples[1]).toBeCloseTo(0.5, 4);
  });

  it("returns null when the declared data chunk is truncated", () => {
    const wav = encodeWav(sine(), SAMPLE_RATE).subarray(0, 100);
    expect(parseWavPcm16(wav)).toBeNull();
  });
});
