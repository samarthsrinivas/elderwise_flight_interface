import type { VoiceAgingMarkers } from "../assessment/types";

type PitchMarkers = Pick<VoiceAgingMarkers,
  "f0MeanHz" | "f0SdHz" | "jitterPct" | "shimmerPct" | "hnrDb" | "voicedRatio">;

export function pitchMarkers(samples: Float32Array, sampleRate: number): PitchMarkers {
  const size = Math.round(sampleRate * 0.04);
  const hop = Math.max(1, Math.round(sampleRate * 0.01));
  const window = Float64Array.from({ length: size }, (_, index) =>
    0.5 * (1 - Math.cos(2 * Math.PI * index / (size - 1))));
  const minLag = Math.max(1, Math.ceil(sampleRate / 400));
  const maxLag = Math.min(size - 2, Math.floor(sampleRate / 60));
  let globalEnergy = 0;
  for (const sample of samples) globalEnergy += sample * sample;
  const threshold = Math.max(0.01, 0.1 * Math.sqrt(globalEnergy / samples.length));
  const periods: number[] = [];
  const amplitudes: number[] = [];
  const frequencies: number[] = [];
  let frameCount = 0;
  let pairCount = 0;
  let periodDifference = 0;
  let amplitudeDifference = 0;
  let harmonicity = 0;
  let previous: { readonly period: number; readonly amplitude: number } | null = null;
  const acf = new Float64Array(maxLag + 2);
  for (let start = 0; start + size <= samples.length; start += hop) {
    frameCount += 1;
    let energy = 0;
    let amplitude = 0;
    for (let index = 0; index < size; index += 1) {
      const sample = samples[start + index];
      energy += sample * sample;
      amplitude = Math.max(amplitude, Math.abs(sample * window[index]));
    }
    if (Math.sqrt(energy / size) <= threshold) {
      previous = null;
      continue;
    }
    // Pair-weighted Hann normalisation removes taper attenuation from periodicity/HNR.
    for (let lag = minLag - 1; lag <= maxLag + 1; lag += 1) {
      let cross = 0;
      let leftEnergy = 0;
      let rightEnergy = 0;
      for (let index = 0; index + lag < size; index += 1) {
        const weight = window[index] * window[index + lag];
        const left = samples[start + index];
        const right = samples[start + index + lag];
        cross += weight * left * right;
        leftEnergy += weight * left * left;
        rightEnergy += weight * right * right;
      }
      acf[lag] = leftEnergy * rightEnergy > 0 ? cross / Math.sqrt(leftEnergy * rightEnergy) : 0;
    }
    const peaks: number[] = [];
    let best = 0;
    for (let lag = minLag; lag <= maxLag; lag += 1) {
      if (acf[lag] >= acf[lag - 1] && acf[lag] > acf[lag + 1]) {
        peaks.push(lag);
        best = Math.max(best, acf[lag]);
      }
    }
    // Prefer the first near-best peak to avoid choosing a multiple of the period.
    const lag = peaks.find((candidate) => acf[candidate] >= best * 0.95);
    if (lag === undefined || acf[lag] <= 0.45) {
      previous = null;
      continue;
    }
    const curvature = acf[lag - 1] - 2 * acf[lag] + acf[lag + 1];
    const shift = curvature === 0 ? 0 : 0.5 * (acf[lag - 1] - acf[lag + 1]) / curvature;
    const period = (lag + shift) / sampleRate;
    const correlation = Math.max(0.01, Math.min(0.999,
      acf[lag] - 0.25 * (acf[lag - 1] - acf[lag + 1]) * shift));
    if (previous) {
      pairCount += 1;
      periodDifference += Math.abs(period - previous.period);
      amplitudeDifference += Math.abs(amplitude - previous.amplitude);
    }
    previous = { period, amplitude };
    periods.push(period);
    amplitudes.push(amplitude);
    frequencies.push(1 / period);
    harmonicity += 10 * Math.log10(correlation / (1 - correlation));
  }
  const voicedCount = periods.length;
  const meanPeriod = periods.reduce((sum, value) => sum + value, 0) / voicedCount;
  const meanAmplitude = amplitudes.reduce((sum, value) => sum + value, 0) / voicedCount;
  const meanFrequency = frequencies.reduce((sum, value) => sum + value, 0) / voicedCount;
  return {
    f0MeanHz: voicedCount >= 5 ? meanFrequency : null,
    f0SdHz: voicedCount >= 5 ? Math.sqrt(frequencies.reduce((sum, value) => sum + (value - meanFrequency) ** 2, 0) / voicedCount) : null,
    jitterPct: pairCount ? 100 * periodDifference / pairCount / meanPeriod : null,
    shimmerPct: pairCount ? 100 * amplitudeDifference / pairCount / meanAmplitude : null,
    hnrDb: voicedCount ? harmonicity / voicedCount : null,
    voicedRatio: frameCount ? voicedCount / frameCount : 0,
  };
}
