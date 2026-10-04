import type { VoiceAgingMarkers } from "../assessment/types";

type RhythmMarkers = Pick<VoiceAgingMarkers,
  "speechRateSylPerS" | "articulationRateSylPerS" | "pauseCount" | "pauseRatio">;

export function rhythmMarkers(samples: Float32Array, sampleRate: number): RhythmMarkers {
  const size = Math.max(1, Math.round(sampleRate * 0.02));
  const hop = Math.max(1, Math.round(sampleRate * 0.01));
  const hopS = hop / sampleRate;
  const duration = samples.length / sampleRate;
  const envelope: number[] = [];
  for (let start = 0; start + size <= samples.length; start += hop) {
    let energy = 0;
    for (let index = start; index < start + size; index += 1) energy += samples[index] ** 2;
    envelope.push(Math.sqrt(energy / size));
  }
  const smoothed = envelope.map((value, index) =>
    ((envelope[index - 1] ?? value) + value + (envelope[index + 1] ?? value)) / 3);
  const sorted = [...smoothed].sort((left, right) => left - right);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const p90 = sorted[Math.floor((sorted.length - 1) * 0.9)] ?? 0;
  const threshold = median + 0.5 * (p90 - median);
  const candidates: number[] = [];
  for (let index = 1; index + 1 < smoothed.length; index += 1) {
    if (smoothed[index] > threshold && smoothed[index] > smoothed[index - 1]
      && smoothed[index] >= smoothed[index + 1]) candidates.push(index);
  }
  // Keep stronger nuclei first, suppressing peaks within 120 ms.
  candidates.sort((left, right) => smoothed[right] - smoothed[left]);
  const nuclei: number[] = [];
  for (const candidate of candidates) {
    if (nuclei.every((index) => Math.abs(index - candidate) * hopS >= 0.12)) nuclei.push(candidate);
  }
  const active = smoothed.map((value) => value > 0 && value >= 0.1 * p90);
  const first = active.indexOf(true);
  const last = active.lastIndexOf(true);
  const effectiveDuration = first < 0 ? 0 : Math.min(duration, (last - first) * hopS + size / sampleRate);
  let pauseTime = 0;
  let pauseCount = 0;
  let run = 0;
  for (let index = first; index <= last && first >= 0; index += 1) {
    if (!active[index]) {
      run += 1;
    } else {
      // Only internal low-energy runs of at least 250 ms count as pauses.
      if (run * hopS >= 0.25) {
        pauseCount += 1;
        pauseTime += run * hopS;
      }
      run = 0;
    }
  }
  const speakingTime = duration - pauseTime;
  return {
    speechRateSylPerS: nuclei.length >= 2 ? nuclei.length / duration : null,
    articulationRateSylPerS: nuclei.length >= 2 && speakingTime > 0 ? nuclei.length / speakingTime : null,
    pauseCount,
    pauseRatio: effectiveDuration >= 1 ? pauseTime / effectiveDuration : null,
  };
}
