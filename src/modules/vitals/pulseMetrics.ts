import { detrend, powerSpectrum } from "./signalProcessing";
import type { RgbSample } from "./signalProcessing";

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function validIntervals(ibi: readonly number[]): number[] {
  const plausible = ibi.filter(value => Number.isFinite(value) && value >= 300 && value <= 2000);
  const center = median(plausible);
  return plausible.filter(value => Math.abs(value - center) <= 0.3 * center);
}

export function estimateHeartRate(x: Float64Array, fs: number): { bpm: number | null; snr: number | null } {
  const { freqs, power } = powerSpectrum(x, fs, 0.7, 3);
  const peak = power.reduce((best, value, index) => value > power[best] ? index : best, 0);
  if (!(power[peak] > 1e-16) || !Number.isFinite(power[peak])) return { bpm: null, snr: null };
  let signal = 0;
  let noise = 0;
  power.forEach((value, index) => {
    if (Math.abs(freqs[index] - freqs[peak]) <= 0.100001 || Math.abs(freqs[index] - 2 * freqs[peak]) <= 0.100001) signal += value;
    else noise += value;
  });
  const snr = 10 * Math.log10(signal / Math.max(noise, signal * 1e-12));
  return { bpm: freqs[peak] * 60, snr: Number.isFinite(snr) ? snr : null };
}

export function detectPeaks(x: Float64Array, fs: number, minDistanceS: number): number[] {
  if (!Number.isFinite(fs) || fs <= 0 || !Number.isFinite(minDistanceS) || minDistanceS <= 0) return [];
  const candidates: number[] = [];
  for (let index = 1; index < x.length - 1; index++) {
    if (x[index] > 0 && x[index] > x[index - 1] && x[index] >= x[index + 1]) candidates.push(index);
  }
  const chosen: number[] = [];
  for (const candidate of candidates.sort((left, right) => x[right] - x[left])) {
    if (chosen.every(index => Math.abs(index - candidate) >= fs * minDistanceS)) chosen.push(candidate);
  }
  return chosen.sort((left, right) => left - right);
}

export function interBeatIntervalsMs(peakIdx: readonly number[], fs: number): number[] {
  if (!Number.isFinite(fs) || fs <= 0) return [];
  return validIntervals(peakIdx.slice(1).map((peak, index) => (peak - peakIdx[index]) * 1000 / fs));
}

export function rmssd(ibi: readonly number[]): number | null {
  const valid = validIntervals(ibi);
  if (valid.length < 2) return null;
  const sum = valid.slice(1).reduce((total, value, index) => total + (value - valid[index]) ** 2, 0);
  return Math.sqrt(sum / (valid.length - 1));
}

export function sdnn(ibi: readonly number[]): number | null {
  const valid = validIntervals(ibi);
  if (valid.length < 2) return null;
  const mean = valid.reduce((sum, value) => sum + value / valid.length, 0);
  return Math.sqrt(valid.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (valid.length - 1));
}

export function estimateRespiratoryRate(samples: readonly RgbSample[] | Float64Array, fs: number): number | null {
  const green = samples instanceof Float64Array ? samples : Float64Array.from(samples, sample => sample.g);
  const { freqs, power } = powerSpectrum(detrend(green, Math.round(fs * 10)), fs, 0.1, 0.5, 0.005);
  const peak = power.reduce((best, value, index) => value > power[best] ? index : best, 0);
  if (!(power[peak] > 1e-16) || !Number.isFinite(power[peak]) || power[peak] < 2 * median([...power])) return null;
  return freqs[peak] * 60;
}
