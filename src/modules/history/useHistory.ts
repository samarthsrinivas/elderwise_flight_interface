import { useCallback, useEffect, useState } from "react";
import { toMessage } from "../../lib/errors";
import type { BandTone } from "../../ui/bandColor";
import { HistoryUnavailableError, clearSessions, readSessions } from "./api";
import type { SessionRecord } from "./types";

export type HistoryPhase = "loading" | "unavailable" | "error" | "empty" | "ready";

export interface TrendPoint {
  recordedAt: string;
  value: number;
  band: BandTone;
}

export interface TrendSeries {
  f0MeanHz: TrendPoint[];
  hnrDb: TrendPoint[];
  speechRate: TrendPoint[];
  heartRate: TrendPoint[];
  hrvRmssd: TrendPoint[];
  saccadeLatency: TrendPoint[];
  fixationStability: TrendPoint[];
}

export function sortByRecordedAt(
  records: readonly SessionRecord[],
): SessionRecord[] {
  return [...records].sort(
    (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt),
  );
}

/** Chartable series (oldest first) across recorded biomarker trends. */
export function buildTrendSeries(
  records: readonly SessionRecord[],
): TrendSeries {
  const series: TrendSeries = {
    f0MeanHz: [],
    hnrDb: [],
    speechRate: [],
    heartRate: [],
    hrvRmssd: [],
    saccadeLatency: [],
    fixationStability: [],
  };

  for (const record of sortByRecordedAt(records)) {
    const recordedAt = record.completedAt || record.startedAt;

    // Voice markers
    if (record.voice) {
      const { markers, band } = record.voice;
      if (markers.f0MeanHz !== null) {
        series.f0MeanHz.push({ recordedAt, value: markers.f0MeanHz, band });
      }
      if (markers.hnrDb !== null) {
        series.hnrDb.push({ recordedAt, value: markers.hnrDb, band });
      }
      if (markers.speechRateSylPerS !== null) {
        series.speechRate.push({ recordedAt, value: markers.speechRateSylPerS, band });
      }
    }

    // Vitals markers
    if (record.vitals) {
      const { heartRateBpm, hrvRmssdMs, band } = record.vitals;
      if (heartRateBpm !== null) {
        series.heartRate.push({ recordedAt, value: heartRateBpm, band });
      }
      if (hrvRmssdMs !== null) {
        series.hrvRmssd.push({ recordedAt, value: hrvRmssdMs, band });
      }
    }

    // Eye movement markers
    if (record.eye) {
      const { tasks, band } = record.eye;
      const prosaccade = tasks.find((t) => t.task === "prosaccade");
      if (prosaccade && prosaccade.meanSaccadeLatencyMs !== null) {
        series.saccadeLatency.push({
          recordedAt,
          value: prosaccade.meanSaccadeLatencyMs,
          band,
        });
      }
      const fixation = tasks.find((t) => t.task === "fixation");
      if (fixation && fixation.fixationStability !== null) {
        series.fixationStability.push({
          recordedAt,
          value: fixation.fixationStability,
          band,
        });
      }
    }
  }

  return series;
}

export interface HistoryController {
  phase: HistoryPhase;
  sessions: SessionRecord[];
  error: string | null;
  refresh: () => Promise<void>;
  clear: () => Promise<void>;
}

export function useHistory(): HistoryController {
  const [phase, setPhase] = useState<HistoryPhase>("loading");
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const stored = await readSessions();
      setSessions(stored);
      setPhase(stored.length === 0 ? "empty" : "ready");
    } catch (raised) {
      if (raised instanceof HistoryUnavailableError) {
        setPhase("unavailable");
        return;
      }
      setError(toMessage(raised));
      setPhase("error");
    }
  }, []);

  const clear = useCallback(async () => {
    setError(null);
    try {
      await clearSessions();
      setSessions([]);
      setPhase("empty");
    } catch (raised) {
      setError(toMessage(raised));
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { phase, sessions, error, refresh, clear };
}
