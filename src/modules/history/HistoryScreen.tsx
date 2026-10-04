import { useState } from "react";
import { bandMeta } from "../../ui/bandColor";
import { savePdf } from "../export/api";
import { buildAssessmentPdf } from "../export/assessmentPdf";
import { Sparkline } from "./Sparkline";
import type { SessionRecord } from "./types";
import {
  type TrendPoint,
  buildTrendSeries,
  useHistory,
} from "./useHistory";

function formatWhen(recordedAt: string): string {
  const stamp = Date.parse(recordedAt);
  if (!Number.isFinite(stamp)) return recordedAt;
  return new Date(stamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function TrendBlock({
  title,
  unit,
  points,
  decimals = 0,
}: {
  title: string;
  unit: string;
  points: readonly TrendPoint[];
  decimals?: number;
}) {
  const latest = points[points.length - 1];
  if (!latest) return null;
  return (
    <div className="stat">
      <div className="value">
        {latest.value.toFixed(decimals)}
        <span className="label"> {unit}</span>
      </div>
      <div className="label">{title}</div>
      <Sparkline points={points} label={`${title} trend over ${points.length} sessions`} />
      <div className="hint" style={{ marginTop: "var(--space-1)" }}>
        {points.length === 1
          ? "1 recorded session"
          : `${points.length} sessions since ${formatWhen(points[0]?.recordedAt ?? "")}`}
      </div>
    </div>
  );
}

function SessionRow({
  session,
  onExport,
}: {
  session: SessionRecord;
  onExport: (session: SessionRecord) => void;
}) {
  const meta = bandMeta(session.overallBand);
  const prosaccade = session.eye?.tasks.find((t) => t.task === "prosaccade");

  return (
    <li className="history-row">
      <div className="history-row__meta">
        <strong>{formatWhen(session.startedAt)}</strong>
        <span className="hint">
          {session.participant.age ? `Age ${session.participant.age} · ` : ""}
          {session.participant.sex}
        </span>
      </div>
      <div className="history-row__badges">
        <span
          className="badge"
          style={{
            background: `var(${meta.softVarName})`,
            color: `var(${meta.varName})`,
          }}
        >
          {meta.label}
        </span>
        {session.vitals?.heartRateBpm && (
          <span className="badge neutral">
            HR: {Math.round(session.vitals.heartRateBpm)} bpm
          </span>
        )}
        {session.voice?.markers.f0MeanHz && (
          <span className="badge neutral">
            F0: {Math.round(session.voice.markers.f0MeanHz)} Hz
          </span>
        )}
        {prosaccade?.meanSaccadeLatencyMs && (
          <span className="badge neutral">
            Saccade: {Math.round(prosaccade.meanSaccadeLatencyMs)} ms
          </span>
        )}
        <button
          type="button"
          className="secondary"
          style={{ minHeight: "36px", padding: "4px 12px", fontSize: "var(--text-sm)" }}
          onClick={() => onExport(session)}
        >
          Export PDF
        </button>
      </div>
    </li>
  );
}

export function HistoryScreen() {
  const history = useHistory();
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  const handleExport = async (session: SessionRecord) => {
    setExporting(true);
    setExportMessage(null);
    try {
      const bytes = await buildAssessmentPdf(session);
      const fileName = `Elderwise_Report_${session.startedAt.slice(0, 10)}.pdf`;
      const saved = await savePdf(fileName, bytes);
      if (saved) {
        setExportMessage("PDF report exported successfully.");
      }
    } catch (err) {
      setExportMessage(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="screen">
      <h1>Check-in History</h1>
      <p className="lede">Review past wellness sessions and view biomarker trends over time.</p>

      {exportMessage && (
        <div className="panel" style={{ padding: "var(--space-3) var(--space-4)" }}>
          <p className="hint" style={{ margin: 0 }}>{exportMessage}</p>
        </div>
      )}

      {history.phase === "loading" && (
        <div className="panel">
          <p className="hint">Loading history...</p>
        </div>
      )}

      {history.phase === "unavailable" && (
        <div className="panel">
          <p className="hint">History store is unavailable outside the desktop app window.</p>
        </div>
      )}

      {history.phase === "error" && (
        <div className="panel">
          <p className="error">{history.error}</p>
          <button
            type="button"
            className="secondary"
            onClick={() => void history.refresh()}
          >
            Try Again
          </button>
        </div>
      )}

      {history.phase === "empty" && (
        <div className="panel">
          <h2>No Past Sessions</h2>
          <p className="hint">Complete a guided check-in to begin tracking your wellness history.</p>
        </div>
      )}

      {history.phase === "ready" && (
        <ReadyPanels
          sessions={history.sessions}
          onExport={handleExport}
          onClear={() => void history.clear()}
          exporting={exporting}
        />
      )}
    </section>
  );
}

function ReadyPanels({
  sessions,
  onExport,
  onClear,
  exporting,
}: {
  sessions: SessionRecord[];
  onExport: (session: SessionRecord) => void;
  onClear: () => void;
  exporting: boolean;
}) {
  const [confirmingClear, setConfirmingClear] = useState(false);
  const series = buildTrendSeries(sessions);
  const anyTrend =
    series.heartRate.length > 0 ||
    series.f0MeanHz.length > 0 ||
    series.saccadeLatency.length > 0 ||
    series.hrvRmssd.length > 0;

  return (
    <>
      {anyTrend && (
        <div className="panel">
          <h2>Biomarker Trends</h2>
          <div className="trend-grid">
            <TrendBlock
              title="Heart Rate"
              unit="bpm"
              points={series.heartRate}
            />
            <TrendBlock
              title="Heart Rate Variability"
              unit="ms"
              points={series.hrvRmssd}
            />
            <TrendBlock
              title="Voice Pitch (F0)"
              unit="Hz"
              points={series.f0MeanHz}
            />
            <TrendBlock
              title="Saccade Latency"
              unit="ms"
              points={series.saccadeLatency}
            />
          </div>
        </div>
      )}

      <div className="panel">
        <h2>
          All Sessions <span className="hint">({sessions.length})</span>
        </h2>
        <ul className="history-list">
          {sessions.map((session) => (
            <SessionRow key={session.id} session={session} onExport={onExport} />
          ))}
        </ul>

        {confirmingClear ? (
          <div className="answer-row" role="group" aria-label="Confirm clear history">
            <p className="hint" style={{ margin: 0, width: "100%" }}>
              Are you sure you want to permanently clear all history?
            </p>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setConfirmingClear(false);
                onClear();
              }}
            >
              Yes, delete all
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => setConfirmingClear(false)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="answer-row">
            <button
              type="button"
              className="secondary"
              disabled={exporting}
              onClick={() => setConfirmingClear(true)}
            >
              Clear History
            </button>
          </div>
        )}
      </div>
    </>
  );
}
