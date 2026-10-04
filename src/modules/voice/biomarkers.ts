import type {
  BandTone, SignalQuality, VoiceAgingMarkers, VoiceCaptureQuality,
  VoiceResult, VoiceTaskId, VoiceTaskResult,
} from "../assessment/types";
import { pitchMarkers } from "./pitch";
import { rhythmMarkers } from "./rhythm";

const QUIET_THRESHOLD = 0.02;
const CLIPPING_THRESHOLD = 0.98;
const QUALITY_RANK = { good: 0, fair: 1, poor: 2, unavailable: 3 } as const;

function readAscii(view: DataView, offset: number, length: number): string {
  let text = "";
  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(view.getUint8(offset + index));
  }
  return text;
}

export function parseWavPcm16(wav: Uint8Array): { samples: Float32Array; sampleRate: number } | null {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  if (view.byteLength < 12 || readAscii(view, 0, 4) !== "RIFF" || readAscii(view, 8, 4) !== "WAVE") return null;
  const end = view.getUint32(4, true) + 8;
  if (end > view.byteLength || end < 12) return null;
  let channels = 0;
  let sampleRate = 0;
  let dataStart = 0;
  let dataSize = 0;
  let offset = 12;
  while (offset + 8 <= end) {
    const id = readAscii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + size > end) return null;
    if (id === "fmt ") {
      if (size < 16 || view.getUint16(start, true) !== 1 || view.getUint16(start + 14, true) !== 16) return null;
      channels = view.getUint16(start + 2, true);
      sampleRate = view.getUint32(start + 4, true);
      if ((channels !== 1 && channels !== 2) || sampleRate === 0 || view.getUint16(start + 12, true) !== channels * 2) return null;
    } else if (id === "data") {
      dataStart = start;
      dataSize = size;
    }
    // RIFF chunks with odd byte lengths have one padding byte.
    offset = start + size + size % 2;
  }
  if (offset !== end || channels === 0 || dataStart === 0 || dataSize % (channels * 2) !== 0) return null;
  const samples = new Float32Array(dataSize / (channels * 2));
  for (let index = 0; index < samples.length; index += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      sum += view.getInt16(dataStart + (index * channels + channel) * 2, true) / 32768;
    }
    samples[index] = sum / channels;
  }
  return { samples, sampleRate };
}

export function computeCaptureQuality(samples: Float32Array, sampleRate: number): VoiceCaptureQuality {
  let sumSquares = 0;
  let peakLevel = 0;
  let quietSamples = 0;
  let clippedSamples = 0;
  for (const sample of samples) {
    const amplitude = Math.abs(sample);
    sumSquares += amplitude * amplitude;
    peakLevel = Math.max(peakLevel, amplitude);
    if (amplitude < QUIET_THRESHOLD) quietSamples += 1;
    if (amplitude >= CLIPPING_THRESHOLD) clippedSamples += 1;
  }
  const durationS = sampleRate > 0 ? samples.length / sampleRate : 0;
  const rmsLevel = samples.length ? Math.sqrt(sumSquares / samples.length) : 0;
  const quietRatio = samples.length ? quietSamples / samples.length : 0;
  const clippingRatio = samples.length ? clippedSamples / samples.length : 0;
  const quality = durationS < 0.5 || samples.length === 0 ? "unavailable"
    : quietRatio > 0.9 || clippingRatio > 0.02 || rmsLevel < 0.005 ? "poor"
    : quietRatio > 0.6 || clippingRatio > 0.005 || rmsLevel < 0.015 ? "fair" : "good";
  return { durationS, rmsLevel, peakLevel, quietRatio, clippingRatio, quality };
}

export function emptyVoiceMarkers(): VoiceAgingMarkers {
  return {
    f0MeanHz: null, f0SdHz: null, jitterPct: null, shimmerPct: null,
    hnrDb: null, speechRateSylPerS: null, articulationRateSylPerS: null,
    pauseRatio: null, pauseCount: 0, voicedRatio: 0,
  };
}

export function computeVoiceAgingMarkers(samples: Float32Array, sampleRate: number): VoiceAgingMarkers {
  if (sampleRate <= 0 || samples.length < Math.max(3, Math.round(sampleRate * 0.04))) return emptyVoiceMarkers();
  return { ...pitchMarkers(samples, sampleRate), ...rhythmMarkers(samples, sampleRate) };
}

export function analyzeVoiceTask(task: VoiceTaskId, prompt: string, transcript: string, wav: Uint8Array): VoiceTaskResult {
  const parsed = parseWavPcm16(wav);
  return {
    task, prompt, transcript,
    capture: computeCaptureQuality(parsed?.samples ?? new Float32Array(), parsed?.sampleRate ?? 16000),
    markers: parsed ? computeVoiceAgingMarkers(parsed.samples, parsed.sampleRate) : emptyVoiceMarkers(),
  };
}

function meanMarker(tasks: readonly VoiceTaskResult[], key: keyof VoiceAgingMarkers): number | null {
  const values = tasks.map((task) => task.markers[key]).filter((value) => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function aggregateVoiceResult(tasks: readonly VoiceTaskResult[]): VoiceResult {
  const vowel = tasks.filter((task) => task.task === "sustained-vowel");
  const pitchTasks = vowel.length ? vowel : tasks;
  const speechTasks = tasks.filter((task) => task.task !== "sustained-vowel");
  const markers: VoiceAgingMarkers = {
    f0MeanHz: meanMarker(pitchTasks, "f0MeanHz"),
    f0SdHz: meanMarker(pitchTasks, "f0SdHz"),
    jitterPct: meanMarker(pitchTasks, "jitterPct"),
    shimmerPct: meanMarker(pitchTasks, "shimmerPct"),
    hnrDb: meanMarker(pitchTasks, "hnrDb"),
    speechRateSylPerS: meanMarker(speechTasks, "speechRateSylPerS"),
    articulationRateSylPerS: meanMarker(speechTasks, "articulationRateSylPerS"),
    pauseRatio: meanMarker(speechTasks, "pauseRatio"),
    pauseCount: meanMarker(speechTasks, "pauseCount") ?? 0,
    voicedRatio: meanMarker(tasks, "voicedRatio") ?? 0,
  };
  const quality = tasks.reduce<SignalQuality>((worst, task) =>
    QUALITY_RANK[task.capture.quality] > QUALITY_RANK[worst] ? task.capture.quality : worst,
  tasks.length ? "good" : "unavailable");
  return { tasks: [...tasks], markers, quality, band: voiceBand(markers, quality) };
}

export function voiceBand(markers: VoiceAgingMarkers, quality: SignalQuality): BandTone {
  // Screening heuristic, not diagnosis: generic jitter >1.5%, shimmer >5%,
  // HNR <15 dB, rate <2.5 syllables/s, pause share >35%; poor capture limits interpretation.
  if (QUALITY_RANK[quality] >= QUALITY_RANK.poor) return "limited";
  const outliers = [
    markers.jitterPct !== null && markers.jitterPct > 1.5,
    markers.shimmerPct !== null && markers.shimmerPct > 5,
    markers.hnrDb !== null && markers.hnrDb < 15,
    markers.speechRateSylPerS !== null && markers.speechRateSylPerS < 2.5,
    markers.pauseRatio !== null && markers.pauseRatio > 0.35,
  ].filter(Boolean).length;
  return outliers >= 2 ? "limited" : outliers === 1 ? "moderate" : "good";
}
