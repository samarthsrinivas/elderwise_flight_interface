import { useEffect, useId, useRef } from "react";
import type { VitalsResult } from "../assessment/types";
import { bandMeta } from "../../ui/bandColor";
import type { useVitalsCapture } from "./useVitalsCapture";
import { PulseTrace } from "./PulseTrace";
import "./vitals.css";

export interface VitalsPanelProps {
  readonly controller: ReturnType<typeof useVitalsCapture>;
  readonly onComplete?: (result: VitalsResult) => void;
}

const phaseCopy = {
  idle: "Ready when you are",
  requesting: "Waiting for camera permission...",
  "loading-model": "Preparing the on-device face detector...",
  capturing: "Keep still and breathe naturally",
  analyzing: "Calculating your estimates on this device...",
  done: "Your camera check is complete",
  error: "We could not complete the camera check",
} as const;

function snrQuality(snr: number | null): {
  readonly label: string;
  readonly tone: "searching" | "weak" | "good";
} {
  if (snr === null || snr < 0) {
    return { label: "Searching", tone: "searching" };
  }
  if (snr < 3) {
    return { label: "Weak signal", tone: "weak" };
  }
  return { label: "Good signal", tone: "good" };
}

const RING_CIRCUMFERENCE = 144.51; // 2 * Math.PI * 23

export function VitalsPanel({ controller, onComplete }: VitalsPanelProps) {
  const headingId = useId();
  const reported = useRef<VitalsResult | null>(null);
  const { phase, result } = controller;

  useEffect(() => {
    if (phase === "done" && result && onComplete && reported.current !== result) {
      reported.current = result;
      onComplete(result);
    }
  }, [phase, result, onComplete]);

  const busy = ["requesting", "loading-model", "capturing", "analyzing"].includes(phase);
  const isLive = phase === "capturing" || phase === "analyzing";
  const band = result ? bandMeta(result.band) : null;
  const quality = snrQuality(controller.liveSnr);

  const liveBpm = controller.liveBpm;
  const hasLiveBpm = liveBpm !== null && Number.isFinite(liveBpm) && liveBpm > 0;
  const heartStyle = hasLiveBpm
    ? { animationDuration: `${(60 / liveBpm).toFixed(2)}s` }
    : undefined;

  const progressNorm = Math.min(1, Math.max(0, controller.progress));
  const progressPercent = Math.round(progressNorm * 100);
  const strokeOffset = RING_CIRCUMFERENCE * (1 - progressNorm);
  const elapsedSeconds = Math.min(30, Math.floor(controller.elapsedS));

  const metrics = result
    ? [
        { label: "Heart rate", value: result.heartRateBpm, unit: "beats/min" },
        { label: "Beat variability (RMSSD)", value: result.hrvRmssdMs, unit: "ms" },
        { label: "Beat variability (SDNN)", value: result.hrvSdnnMs, unit: "ms" },
        { label: "Breathing rate", value: result.respiratoryRateBpm, unit: "breaths/min" },
      ]
    : [];

  return (
    <section className="vitals-panel" aria-labelledby={headingId}>
      <header>
        <p className="vitals-eyebrow">ON-DEVICE CAMERA CHECK</p>
        <h2 id={headingId}>A quiet moment for your vitals</h2>
        <p>
          Sit comfortably in even light, look toward the camera, and keep your face still. Your video stays on this device.
        </p>
      </header>
      <div className="vitals-capture-layout">
        <div className="vitals-preview">
          <video
            ref={controller.videoRef}
            autoPlay
            muted
            playsInline
            width={640}
            height={480}
            aria-label="Mirrored camera preview"
          />
          {!busy && (
            <p className="vitals-preview-placeholder">
              {phase === "done" ? "Camera is off" : "Your camera preview will appear here"}
            </p>
          )}
        </div>
        <div className="vitals-capture-status">
          <div className="vitals-status-pills">
            <span
              className="vitals-face-pill"
              data-detected={controller.faceDetected}
              role="status"
            >
              {controller.faceDetected
                ? "Face detected"
                : busy
                  ? "Looking for your face"
                  : "Camera is off"}
            </span>
            {isLive && (
              <span
                className={`vitals-snr-pill vitals-snr-pill--${quality.tone}`}
                role="status"
              >
                <span className="vitals-snr-dot" aria-hidden="true" />
                {quality.label}
              </span>
            )}
          </div>

          <p className="vitals-phase" role="status">
            {phaseCopy[phase]}
          </p>

          {isLive && (
            <div className="vitals-live-deck">
              <div className="vitals-live-card">
                <div className="vitals-live">
                  <svg
                    className={`vitals-heart-icon ${hasLiveBpm ? "is-pulsing" : ""}`}
                    style={heartStyle}
                    viewBox="0 0 24 24"
                    width={32}
                    height={32}
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                  </svg>
                  <strong className="vitals-bpm-value">
                    {liveBpm === null ? "--" : Math.round(liveBpm)}
                  </strong>
                  <span className="vitals-live-unit">beats per minute (live)</span>
                </div>
              </div>

              <PulseTrace
                trace={controller.pulseTrace}
                faceDetected={controller.faceDetected}
              />

              <div className="vitals-progress-card">
                <div
                  className="vitals-progress"
                  role="progressbar"
                  aria-valuenow={progressPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Camera check progress"
                >
                  <div className="vitals-progress-ring-wrap" aria-hidden="true">
                    <svg
                      width={56}
                      height={56}
                      viewBox="0 0 56 56"
                      className="vitals-progress-ring"
                    >
                      <circle
                        cx={28}
                        cy={28}
                        r={23}
                        className="vitals-progress-ring-track"
                        strokeWidth={4.5}
                        fill="none"
                      />
                      <circle
                        cx={28}
                        cy={28}
                        r={23}
                        className="vitals-progress-ring-rail"
                        strokeWidth={4.5}
                        fill="none"
                        strokeLinecap="round"
                        strokeDasharray={RING_CIRCUMFERENCE}
                        strokeDashoffset={strokeOffset}
                        transform="rotate(-90 28 28)"
                      />
                    </svg>
                    <span className="vitals-progress-ring-label">
                      {progressPercent}%
                    </span>
                  </div>
                  <div className="vitals-progress-info">
                    <span className="vitals-progress-seconds">
                      {elapsedSeconds}s / 30s
                    </span>
                    <p className="vitals-timing">
                      {elapsedSeconds} seconds captured · {progressPercent}%
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="vitals-actions">
            <button
              type="button"
              className="vitals-start"
              onClick={() => void controller.start()}
              disabled={busy}
            >
              {phase === "done" || phase === "error" ? "Try again" : "Start camera check"}
            </button>
            {busy && (
              <button type="button" onClick={controller.cancel}>
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
      {controller.error && (
        <p className="vitals-error" role="alert">
          {controller.error}
        </p>
      )}
      {phase === "done" && result && band && (
        <div className="vitals-results">
          <h3>Your estimates</h3>
          <dl className="vitals-grid">
            {metrics.map((metric) => (
              <div key={metric.label}>
                <dt>{metric.label}</dt>
                <dd>
                  {metric.value === null ? (
                    "Not available"
                  ) : (
                    <>
                      {metric.value.toFixed(0)} <small>{metric.unit}</small>
                    </>
                  )}
                </dd>
              </div>
            ))}
            <div>
              <dt>Signal quality</dt>
              <dd className="vitals-quality">{result.quality}</dd>
            </div>
            <div style={{ background: `var(${band.softVarName})` }}>
              <dt>Wellness band</dt>
              <dd>
                <span
                  className="vitals-band-dot"
                  style={{ background: `var(${band.varName})` }}
                />
                {band.label}
              </dd>
            </div>
          </dl>
          <p>
            Short camera readings can vary with movement and lighting. A limited band may mean the signal needs another try, not a health problem.
          </p>
        </div>
      )}
      <p className="vitals-note">Estimates only — not a medical device.</p>
    </section>
  );
}
