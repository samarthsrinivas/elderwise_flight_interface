import { useEffect, useId, useRef } from "react";
import type { VitalsResult } from "../assessment/types";
import { bandMeta } from "../../ui/bandColor";
import type { useVitalsCapture } from "./useVitalsCapture";
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
  const band = result ? bandMeta(result.band) : null;
  const metrics = result ? [
    { label: "Heart rate", value: result.heartRateBpm, unit: "beats/min" },
    { label: "Beat variability (RMSSD)", value: result.hrvRmssdMs, unit: "ms" },
    { label: "Beat variability (SDNN)", value: result.hrvSdnnMs, unit: "ms" },
    { label: "Breathing rate", value: result.respiratoryRateBpm, unit: "breaths/min" },
  ] : [];

  return (
    <section className="vitals-panel" aria-labelledby={headingId}>
      <header>
        <p className="vitals-eyebrow">ON-DEVICE CAMERA CHECK</p>
        <h2 id={headingId}>A quiet moment for your vitals</h2>
        <p>Sit comfortably in even light, look toward the camera, and keep your face still. Your video stays on this device.</p>
      </header>
      <div className="vitals-capture-layout">
        <div className="vitals-preview">
          <video ref={controller.videoRef} autoPlay muted playsInline width={640} height={480} aria-label="Mirrored camera preview" />
          {!busy && <p className="vitals-preview-placeholder">{phase === "done" ? "Camera is off" : "Your camera preview will appear here"}</p>}
        </div>
        <div className="vitals-capture-status">
          <span className="vitals-face-pill" data-detected={controller.faceDetected} role="status">
            {controller.faceDetected ? "Face detected" : busy ? "Looking for your face" : "Camera is off"}
          </span>
          <p className="vitals-phase" role="status">{phaseCopy[phase]}</p>
          <p className="vitals-live"><strong>{controller.liveBpm === null ? "--" : Math.round(controller.liveBpm)}</strong><span>live beats/min</span></p>
          <progress className="vitals-progress" value={controller.progress} max={1} aria-label="Camera check progress" />
          <p className="vitals-timing">{Math.floor(controller.elapsedS)} seconds captured · {Math.round(controller.progress * 100)}%</p>
          <div className="vitals-actions">
            <button type="button" className="vitals-start" onClick={() => void controller.start()} disabled={busy}>
              {phase === "done" || phase === "error" ? "Try again" : "Start camera check"}
            </button>
            {busy && <button type="button" onClick={controller.cancel}>Cancel</button>}
          </div>
        </div>
      </div>
      {controller.error && <p className="vitals-error" role="alert">{controller.error}</p>}
      {phase === "done" && result && band && (
        <div className="vitals-results">
          <h3>Your estimates</h3>
          <dl className="vitals-grid">
            {metrics.map(metric => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value === null ? "Not available" : <>{metric.value.toFixed(0)} <small>{metric.unit}</small></>}</dd></div>)}
            <div><dt>Signal quality</dt><dd className="vitals-quality">{result.quality}</dd></div>
            <div style={{ background: `var(${band.softVarName})` }}><dt>Wellness band</dt><dd><span className="vitals-band-dot" style={{ background: `var(${band.varName})` }} />{band.label}</dd></div>
          </dl>
          <p>Short camera readings can vary with movement and lighting. A limited band may mean the signal needs another try, not a health problem.</p>
        </div>
      )}
      <p className="vitals-note">Estimates only — not a medical device.</p>
    </section>
  );
}
