import type { AssessmentSession, BandTone, VoiceAgeSummary } from "../assessment/types";
import { bandMeta } from "../../ui/bandColor";
import { PRE_SCREENING_DISCLAIMER } from "../../ui/disclaimer";

export interface ReportRow {
  readonly label: string;
  readonly value: string;
  readonly note?: string;
}

export interface ReportSection {
  readonly title: string;
  readonly band: BandTone | null;
  readonly rows: readonly ReportRow[];
}

export interface ReportModel {
  readonly title: string;
  readonly date: string;
  readonly participantLine: string;
  readonly overallBand: BandTone;
  readonly overallBandLabel: string;
  readonly sections: readonly ReportSection[];
  readonly summaryText: string | null;
  readonly disclaimer: string;
}

function formatNumber(val: number | null, unit: string, decimals = 1): string {
  if (val === null || !Number.isFinite(val)) return "Not available";
  return `${val.toFixed(decimals)} ${unit}`.trim();
}

function formatPercent(val: number | null): string {
  if (val === null || !Number.isFinite(val)) return "Not available";
  return `${val.toFixed(1)}%`;
}

export interface VoiceAgeDisplay {
  readonly value: string;
  readonly note: string | null;
}

/** Gap vs stated age is derived at report time; it is never stored in the session. */
export function formatVoiceAge(
  age: VoiceAgeSummary | null,
  participantAge: number | null,
): VoiceAgeDisplay | null {
  if (!age || !Number.isFinite(age.ageYears)) return null;
  const years = Math.round(age.ageYears);
  const value = `${years} years (±${age.maeYears.toFixed(1)})`;
  if (participantAge === null) return { value, note: null };
  const gap = years - participantAge;
  if (Math.abs(gap) <= age.maeYears) {
    return { value, note: `Within model error of stated age ${participantAge}.` };
  }
  const direction = gap > 0 ? "above" : "below";
  return {
    value,
    note: `About ${Math.abs(gap)} years ${direction} stated age ${participantAge}.`,
  };
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function buildReportModel(session: AssessmentSession): ReportModel {
  const p = session.participant;
  const participantParts: string[] = [];
  if (p.age !== null) participantParts.push(`Age: ${p.age}`);
  participantParts.push(`Sex: ${p.sex}`);
  const participantLine = participantParts.join(" · ");

  // Voice section
  const voiceRows: ReportRow[] = [];
  if (session.voice) {
    const { markers } = session.voice;
    voiceRows.push({
      label: "Mean Fundamental Frequency (F0)",
      value: formatNumber(markers.f0MeanHz, "Hz", 1),
    });
    voiceRows.push({
      label: "Harmonics-to-Noise Ratio (HNR)",
      value: formatNumber(markers.hnrDb, "dB", 1),
    });
    voiceRows.push({
      label: "Speech Rate",
      value: formatNumber(markers.speechRateSylPerS, "syl/s", 1),
    });
    voiceRows.push({
      label: "Local Jitter",
      value: formatPercent(markers.jitterPct),
    });
    voiceRows.push({
      label: "Local Shimmer",
      value: formatPercent(markers.shimmerPct),
    });
    const voiceAge = formatVoiceAge(session.voice.age, p.age);
    voiceRows.push({
      label: "Estimated Voice Age",
      value: voiceAge?.value ?? "Not available",
      note: voiceAge
        ? [voiceAge.note, "Population-level estimate from speech; not biological age."]
            .filter((part): part is string => part !== null)
            .join(" ")
        : undefined,
    });
  } else {
    voiceRows.push({ label: "Voice Biomarkers", value: "Not available" });
  }

  // Vitals section
  const vitalsRows: ReportRow[] = [];
  if (session.vitals) {
    const v = session.vitals;
    vitalsRows.push({
      label: "Heart Rate",
      value: formatNumber(v.heartRateBpm, "bpm", 0),
    });
    vitalsRows.push({
      label: "HRV (RMSSD)",
      value: formatNumber(v.hrvRmssdMs, "ms", 1),
    });
    vitalsRows.push({
      label: "Respiratory Rate",
      value: formatNumber(v.respiratoryRateBpm, "bpm", 1),
    });
    vitalsRows.push({
      label: "Face Tracking Coverage",
      value: formatPercent(v.faceCoverage * 100),
    });
  } else {
    vitalsRows.push({ label: "Vitals Biomarkers", value: "Not available" });
  }

  // Eye movement section
  const eyeRows: ReportRow[] = [];
  if (session.eye) {
    const tasks = session.eye.tasks;
    const prosaccade = tasks.find((t) => t.task === "prosaccade");
    const fixation = tasks.find((t) => t.task === "fixation");
    const pursuit = tasks.find((t) => t.task === "smooth-pursuit");

    eyeRows.push({
      label: "Mean Saccade Latency",
      value: formatNumber(prosaccade?.meanSaccadeLatencyMs ?? null, "ms", 0),
    });
    eyeRows.push({
      label: "Saccade Accuracy",
      value: formatPercent(
        prosaccade?.saccadeAccuracy != null ? prosaccade.saccadeAccuracy * 100 : null,
      ),
    });
    eyeRows.push({
      label: "Fixation Stability",
      value: formatNumber(fixation?.fixationStability ?? null, "", 3),
    });
    eyeRows.push({
      label: "Smooth Pursuit Gain",
      value: formatNumber(pursuit?.pursuitGain ?? null, "", 2),
    });
  } else {
    eyeRows.push({ label: "Ocular Biomarkers", value: "Not available" });
  }

  const sections: ReportSection[] = [
    {
      title: "Voice Acoustic Analysis",
      band: session.voice?.band ?? null,
      rows: voiceRows,
    },
    {
      title: "Facial Vitals (rPPG)",
      band: session.vitals?.band ?? null,
      rows: vitalsRows,
    },
    {
      title: "Oculomotor & Saccade Tracking",
      band: session.eye?.band ?? null,
      rows: eyeRows,
    },
  ];

  return {
    title: "Elderwise Wellness Check-in Report",
    date: formatDate(session.startedAt),
    participantLine,
    overallBand: session.overallBand,
    overallBandLabel: bandMeta(session.overallBand).label,
    sections,
    summaryText: session.summaryText,
    disclaimer: PRE_SCREENING_DISCLAIMER,
  };
}
