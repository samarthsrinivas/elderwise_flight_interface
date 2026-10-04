import { bandMeta } from "../../ui/bandColor";
import {
  ASSESSMENT_STEPS,
  type AssessmentSession,
  type AssessmentStep,
  type BandTone,
  type EyeResult,
  type Participant,
  type VitalsResult,
  type VoiceResult,
  assessmentSessionSchema,
} from "./types";

export function nextStep(step: AssessmentStep): AssessmentStep {
  const currentIndex = ASSESSMENT_STEPS.indexOf(step);
  if (currentIndex === -1 || currentIndex >= ASSESSMENT_STEPS.length - 1) {
    return step;
  }
  return ASSESSMENT_STEPS[currentIndex + 1];
}

export function prevStep(step: AssessmentStep): AssessmentStep {
  const currentIndex = ASSESSMENT_STEPS.indexOf(step);
  if (currentIndex <= 0) {
    return step;
  }
  return ASSESSMENT_STEPS[currentIndex - 1];
}

export function overallBand(parts: {
  readonly voice: VoiceResult | null;
  readonly vitals: VitalsResult | null;
  readonly eye: EyeResult | null;
}): BandTone {
  const bands: BandTone[] = [];
  if (parts.voice) bands.push(parts.voice.band);
  if (parts.vitals) bands.push(parts.vitals.band);
  if (parts.eye) bands.push(parts.eye.band);

  if (bands.length === 0) {
    return "moderate";
  }

  if (bands.includes("limited")) {
    return "limited";
  }
  if (bands.includes("moderate")) {
    return "moderate";
  }
  return "good";
}

export interface BuildSessionInput {
  readonly id: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly participant: Participant;
  readonly voice: VoiceResult | null;
  readonly vitals: VitalsResult | null;
  readonly eye: EyeResult | null;
  readonly summaryText: string | null;
}

export function buildSession(input: BuildSessionInput): AssessmentSession {
  const session: AssessmentSession = {
    id: input.id,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    participant: input.participant,
    voice: input.voice,
    vitals: input.vitals,
    eye: input.eye,
    overallBand: overallBand({
      voice: input.voice,
      vitals: input.vitals,
      eye: input.eye,
    }),
    summaryText: input.summaryText,
  };

  return assessmentSessionSchema.parse(session);
}

export function fallbackSummary(session: AssessmentSession): string {
  const meta = bandMeta(session.overallBand);
  const completedNames: string[] = [];
  if (session.voice) completedNames.push("voice acoustics");
  if (session.vitals) completedNames.push("facial vitals");
  if (session.eye) completedNames.push("eye tracking");

  let completionSentence: string;
  if (completedNames.length === 3) {
    completionSentence = "Voice acoustics, facial vitals, and eye tracking were completed.";
  } else if (completedNames.length === 2) {
    completionSentence = `${completedNames[0]} and ${completedNames[1]} were completed, while one module was skipped.`;
  } else if (completedNames.length === 1) {
    completionSentence = `${completedNames[0]} was completed, while remaining modules were skipped.`;
  } else {
    completionSentence = "All check-in modules were skipped.";
  }

  const metricSnippets: string[] = [];
  if (session.voice?.markers.f0MeanHz != null) {
    metricSnippets.push(`voice pitch averaged ${Math.round(session.voice.markers.f0MeanHz)} Hz`);
  }
  if (session.vitals?.heartRateBpm != null) {
    metricSnippets.push(`resting heart rate was estimated at ${Math.round(session.vitals.heartRateBpm)} bpm`);
  }
  if (session.vitals?.respiratoryRateBpm != null) {
    metricSnippets.push(`breathing rate was estimated at ${Math.round(session.vitals.respiratoryRateBpm)} breaths/min`);
  }

  const prosaccade = session.eye?.tasks.find((task) => task.task === "prosaccade");
  if (prosaccade?.meanSaccadeLatencyMs != null) {
    metricSnippets.push(`prosaccade reaction latency was ${Math.round(prosaccade.meanSaccadeLatencyMs)} ms`);
  }

  const metricsSentence = metricSnippets.length > 0
    ? ` Key observations include ${metricSnippets.join(", ")}.`
    : "";

  const disclaimer = "Elderwise provides wellness estimates only. It is not a medical device and does not diagnose any condition.";

  return `${completionSentence} The overall wellness signal is rated as ${meta.label}.${metricsSentence} ${disclaimer}`;
}

export function newSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
