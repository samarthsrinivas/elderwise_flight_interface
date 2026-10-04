import type { VitalsResult } from "../assessment/types";
import { bandpass, cleanSamples, detrend, posSignal, resampleUniform } from "./signalProcessing";
import type { RgbSample } from "./signalProcessing";
import { detectPeaks, estimateHeartRate, estimateRespiratoryRate, interBeatIntervalsMs, rmssd, sdnn } from "./pulseMetrics";

export { bandpass, detrend, posSignal, powerSpectrum, resampleUniform } from "./signalProcessing";
export type { RgbSample } from "./signalProcessing";
export { detectPeaks, estimateHeartRate, estimateRespiratoryRate, interBeatIntervalsMs, rmssd, sdnn } from "./pulseMetrics";

export function analyzeRppg(samples: readonly RgbSample[], opts: { readonly faceCoverage: number; readonly durationS: number }): VitalsResult {
  const cleaned = cleanSamples(samples);
  const faceCoverage = Number.isFinite(opts.faceCoverage) ? Math.max(0, Math.min(1, opts.faceCoverage)) : 0;
  const durationS = Number.isFinite(opts.durationS) ? Math.max(0, opts.durationS) : 0;
  const unavailable: VitalsResult = {
    heartRateBpm: null, hrvRmssdMs: null, hrvSdnnMs: null, respiratoryRateBpm: null,
    signalToNoise: null, quality: "unavailable", durationS, sampleCount: cleaned.length,
    effectiveFps: null, faceCoverage, band: "limited",
  };
  if (durationS < 10 || cleaned.length < 60) return unavailable;
  const spanS = (cleaned[cleaned.length - 1].t - cleaned[0].t) / 1000;
  const fs = Math.min(30, (cleaned.length - 1) / spanS);
  if (!Number.isFinite(fs) || fs <= 6 || spanS + 1 / fs < 10) return unavailable;
  const uniform = resampleUniform(cleaned, fs);
  if (uniform.length < 60) return unavailable;
  const pulse = bandpass(detrend(posSignal(uniform, fs), Math.round(fs * 1.5)), fs, 0.7, 3);
  const { bpm, snr } = estimateHeartRate(pulse, fs);
  if (bpm === null || snr === null) return { ...unavailable, effectiveFps: fs };
  const intervals = interBeatIntervalsMs(detectPeaks(pulse, fs, 0.3), fs);
  const hrvRmssdMs = intervals.length >= 10 ? rmssd(intervals) : null;
  const hrvSdnnMs = intervals.length >= 10 ? sdnn(intervals) : null;
  const quality = snr >= 3 && faceCoverage >= 0.9 ? "good" : snr >= 0 && faceCoverage >= 0.7 ? "fair" : "poor";
  // Non-clinical heuristic: usable quality, HR 50-90 and RMSSD >=20 (or absent)
  // is good; HR 40-110 or low RMSSD is moderate; poor quality is always limited.
  const band = quality === "poor" ? "limited"
    : bpm >= 50 && bpm <= 90 && (hrvRmssdMs === null || hrvRmssdMs >= 20) ? "good"
      : (bpm >= 40 && bpm <= 110) || (hrvRmssdMs !== null && hrvRmssdMs < 20) ? "moderate" : "limited";
  return {
    heartRateBpm: bpm, hrvRmssdMs, hrvSdnnMs, respiratoryRateBpm: estimateRespiratoryRate(uniform, fs),
    signalToNoise: snr, quality, durationS, sampleCount: cleaned.length, effectiveFps: fs, faceCoverage, band,
  };
}
