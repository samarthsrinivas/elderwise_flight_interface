import { z } from "zod";

/**
 * Elderwise domain contract.
 *
 * Every capture module (voice, vitals, eye) produces exactly one of the
 * result shapes below. The assessment flow stitches them into an
 * `AssessmentSession`, the history store persists it, and the PDF export
 * renders it. Keep this file dependency-free so every module can import it
 * without cycles.
 *
 * All biomarker values are `null` when the signal was too poor to compute
 * them - never NaN, never a guessed number.
 */

export const bandToneSchema = z.enum(["good", "moderate", "limited"]);
export type BandTone = z.infer<typeof bandToneSchema>;

export const signalQualitySchema = z.enum(["good", "fair", "poor", "unavailable"]);
export type SignalQuality = z.infer<typeof signalQualitySchema>;

// ---------------------------------------------------------------------------
// Voice (ElevenLabs STT/TTS in the cloud, biomarkers computed locally)
// ---------------------------------------------------------------------------

/** Capture-quality metrics computed from the raw 16 kHz mono WAV. */
export const voiceCaptureQualitySchema = z.object({
  durationS: z.number(),
  rmsLevel: z.number(),
  peakLevel: z.number(),
  quietRatio: z.number(),
  clippingRatio: z.number(),
  quality: signalQualitySchema,
});
export type VoiceCaptureQuality = z.infer<typeof voiceCaptureQualitySchema>;

/**
 * Acoustic ageing markers. Computed locally from the WAV; literature-standard
 * definitions (Praat-style). Null when the clip has too little voiced speech.
 */
export const voiceAgingMarkersSchema = z.object({
  /** Mean fundamental frequency over voiced frames (Hz). */
  f0MeanHz: z.number().nullable(),
  /** Standard deviation of F0 over voiced frames (Hz). */
  f0SdHz: z.number().nullable(),
  /** Local jitter: mean |T_i - T_{i-1}| / mean T, as a percentage. */
  jitterPct: z.number().nullable(),
  /** Local shimmer: mean |A_i - A_{i-1}| / mean A, as a percentage. */
  shimmerPct: z.number().nullable(),
  /** Harmonics-to-noise ratio (dB). */
  hnrDb: z.number().nullable(),
  /** Syllable-nuclei estimate per second of total clip time. */
  speechRateSylPerS: z.number().nullable(),
  /** Syllable-nuclei estimate per second of phonated (non-pause) time. */
  articulationRateSylPerS: z.number().nullable(),
  /** Share of the clip spent in pauses >= 150 ms. */
  pauseRatio: z.number().nullable(),
  /** Number of pauses >= 150 ms. */
  pauseCount: z.number(),
  /** Fraction of analysis frames classified as voiced. */
  voicedRatio: z.number(),
});
export type VoiceAgingMarkers = z.infer<typeof voiceAgingMarkersSchema>;

export const voiceTaskIdSchema = z.enum([
  "sustained-vowel",
  "reading-passage",
  "free-speech",
]);
export type VoiceTaskId = z.infer<typeof voiceTaskIdSchema>;

/** One recorded voice task with its transcript and locally computed markers. */
export const voiceTaskResultSchema = z.object({
  task: voiceTaskIdSchema,
  prompt: z.string(),
  /** Empty string when ASR is off or failed; never null. */
  transcript: z.string(),
  capture: voiceCaptureQualitySchema,
  markers: voiceAgingMarkersSchema,
});
export type VoiceTaskResult = z.infer<typeof voiceTaskResultSchema>;

export const voiceResultSchema = z.object({
  tasks: z.array(voiceTaskResultSchema),
  /** Aggregated across tasks; the headline numbers shown in summaries. */
  markers: voiceAgingMarkersSchema,
  quality: signalQualitySchema,
  band: bandToneSchema,
});
export type VoiceResult = z.infer<typeof voiceResultSchema>;

// ---------------------------------------------------------------------------
// Vitals (webcam rPPG, fully local)
// ---------------------------------------------------------------------------

export const vitalsResultSchema = z.object({
  heartRateBpm: z.number().nullable(),
  /** RMSSD over detected inter-beat intervals (ms). */
  hrvRmssdMs: z.number().nullable(),
  /** Standard deviation of inter-beat intervals (ms). */
  hrvSdnnMs: z.number().nullable(),
  respiratoryRateBpm: z.number().nullable(),
  /** 0..1 spectral peak prominence of the HR band; drives `quality`. */
  signalToNoise: z.number().nullable(),
  quality: signalQualitySchema,
  durationS: z.number(),
  sampleCount: z.number(),
  effectiveFps: z.number().nullable(),
  /** Fraction of frames where a face ROI was tracked. */
  faceCoverage: z.number(),
  band: bandToneSchema,
});
export type VitalsResult = z.infer<typeof vitalsResultSchema>;

// ---------------------------------------------------------------------------
// Eye movement (webcam iris landmarks, fully local)
// ---------------------------------------------------------------------------

export const eyeTaskIdSchema = z.enum(["fixation", "prosaccade", "smooth-pursuit"]);
export type EyeTaskId = z.infer<typeof eyeTaskIdSchema>;

/**
 * Gaze is expressed in normalised screen units (0..1 on each axis) because
 * there is no per-user calibration. Velocities are therefore in units/s, not
 * deg/s; compare within-person over time, not against population norms.
 */
export const eyeTaskResultSchema = z.object({
  task: eyeTaskIdSchema,
  durationS: z.number(),
  sampleCount: z.number(),
  /** Fraction of samples with both irises tracked. */
  trackingCoverage: z.number(),
  /** RMS gaze dispersion during fixation (normalised units). */
  fixationStability: z.number().nullable(),
  saccadeCount: z.number(),
  /** Mean latency from target jump to saccade onset (ms). */
  meanSaccadeLatencyMs: z.number().nullable(),
  /** Mean peak velocity of detected saccades (normalised units/s). */
  meanSaccadePeakVelocity: z.number().nullable(),
  /** Fraction of target jumps followed by a saccade in the correct direction. */
  saccadeAccuracy: z.number().nullable(),
  /** Gaze velocity / target velocity during smooth pursuit (ideal 1.0). */
  pursuitGain: z.number().nullable(),
  /** Blinks per minute. */
  blinkRatePerMin: z.number().nullable(),
});
export type EyeTaskResult = z.infer<typeof eyeTaskResultSchema>;

export const eyeResultSchema = z.object({
  tasks: z.array(eyeTaskResultSchema),
  quality: signalQualitySchema,
  band: bandToneSchema,
});
export type EyeResult = z.infer<typeof eyeResultSchema>;

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export const participantSchema = z.object({
  /** Years; used only for age-adjusted banding. */
  age: z.number().int().min(18).max(120).nullable(),
  sex: z.enum(["female", "male", "unspecified"]),
});
export type Participant = z.infer<typeof participantSchema>;

/** The complete record of one run; persisted verbatim by the history store. */
export const assessmentSessionSchema = z.object({
  id: z.string().min(1),
  startedAt: z.string().min(1),
  completedAt: z.string().min(1),
  participant: participantSchema,
  voice: voiceResultSchema.nullable(),
  vitals: vitalsResultSchema.nullable(),
  eye: eyeResultSchema.nullable(),
  overallBand: bandToneSchema,
  /** Plain-language narrative from the cloud LLM; null when chat is off. */
  summaryText: z.string().nullable(),
});
export type AssessmentSession = z.infer<typeof assessmentSessionSchema>;

/** Ordered steps of the guided flow. */
export const ASSESSMENT_STEPS = ["setup", "voice", "vitals", "eye", "summary"] as const;
export type AssessmentStep = (typeof ASSESSMENT_STEPS)[number];
