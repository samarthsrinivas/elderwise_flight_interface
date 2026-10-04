import { useEffect, useId, useMemo, useRef, useState } from "react";
import { bandMeta } from "../../ui/bandColor";
import { toMessage } from "../../lib/errors";
import type { EyeResult, GazeCalibration } from "../assessment/types";
import { aggregateEyeResults } from "./analyze";
import { calibrationSchedule } from "./calibration";
import { EYE_TASK_ORDER, scheduleFor } from "./tasks";
import type { CalibrationStatus, EyePhase, useEyeTracking } from "./useEyeTracking";
import "./eye.css";

const labels = { fixation: "Keep eyes still", prosaccade: "Look at each jump", "smooth-pursuit": "Follow the dot" } as const;
const display = (value: number | null, digits = 2) => value === null ? "Not available" : value.toFixed(digits);
const fitErrorPercent = (calibration: GazeCalibration) => (Math.max(calibration.residualX, calibration.residualY) * 100).toFixed(1);

export const cameraStatusText = (phase: EyePhase, faceDetected: boolean): string => {
  switch (phase) {
    case "requesting": return "Starting camera…";
    case "loading-model": return "Loading face model…";
    case "running":
    case "analyzing": return faceDetected ? "Face detected" : "Face not detected";
    case "done": return "Camera ready";
    default: return "Camera off";
  }
};

export const calibrationStatusText = (status: CalibrationStatus, calibration: GazeCalibration | null): string => {
  if (status === "ok" && calibration) return `Calibrated · fit error ${fitErrorPercent(calibration)}% of screen`;
  if (status === "failed") return "Calibration too noisy — try again or skip";
  return "Not calibrated — results limited to Watch";
};

export const resultsNote = (summary: EyeResult): string => summary.calibration
  ? `Tracking quality: ${summary.quality}. Calibrated to this screen (fit error ${fitErrorPercent(summary.calibration)}%). Wellness estimates, not diagnostic measurements.`
  : `Tracking quality: ${summary.quality}. Uncalibrated gaze proxies: stability and gain are auto-scaled and not banded.`;

export function EyeTaskCanvas({ controller, onAllDone }: {
  readonly controller: ReturnType<typeof useEyeTracking>;
  readonly onAllDone?: (result: EyeResult) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const instructionId = useId();
  const [actionError, setActionError] = useState<string | null>(null);
  const nextTask = EYE_TASK_ORDER.find(task => !controller.results.some(result => result.task === task));
  const busy = ["requesting", "loading-model", "running", "analyzing"].includes(controller.phase);
  const current = busy ? controller.task ?? "fixation" : nextTask ?? controller.task ?? "fixation";
  const needsCalibration = controller.calibrationStatus === "none";
  const schedule = useMemo(() => controller.calibrating ? calibrationSchedule() : scheduleFor(current), [controller.calibrating, current]);
  const summary = useMemo(() => aggregateEyeResults(controller.results, controller.calibration), [controller.results, controller.calibration]);
  const meta = bandMeta(summary.band);
  const delivered = useRef<readonly unknown[] | null>(null);

  useEffect(() => {
    if (nextTask === undefined && delivered.current !== controller.results) {
      delivered.current = controller.results;
      onAllDone?.(summary);
    }
    if (controller.results.length === 0) delivered.current = null;
  }, [controller.results, nextTask, onAllDone, summary]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const color = getComputedStyle(canvas).getPropertyValue("--surface").trim();
    let animationId = 0;
    const draw = (now: number) => {
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      const timeline = controller.timelineRef.current;
      const point = timeline ? timeline.schedule.targetAt(Math.min(timeline.schedule.durationMs, now - timeline.startedAt)) : null;
      if (point) {
        context.beginPath();
        context.arc(point.x * width, point.y * height, 14, 0, 2 * Math.PI);
        context.fillStyle = color;
        context.fill();
      }
      animationId = requestAnimationFrame(draw);
    };
    animationId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animationId);
  }, [controller.timelineRef]);

  const run = async (action: () => Promise<unknown>) => {
    setActionError(null);
    try { await action(); }
    catch (raised: unknown) {
      if (!(raised instanceof DOMException && raised.name === "AbortError")) setActionError(toMessage(raised));
    }
  };

  const speak = () => {
    if (!("speechSynthesis" in window)) { setActionError("Spoken instructions are unavailable. Please read the instructions above."); return; }
    const voice = window.speechSynthesis.getVoices().find(candidate => candidate.localService && candidate.lang.startsWith("en"));
    if (!voice) { setActionError("No local English voice is available. Please read the instructions above."); return; }
    const utterance = new SpeechSynthesisUtterance(schedule.instructions);
    utterance.voice = voice;
    window.speechSynthesis.speak(utterance);
  };

  const stageMessage = busy ? "Preparing your camera and local model..."
    : needsCalibration ? "Calibrate first so results use screen units, or skip to continue."
    : nextTask ? "Get comfortable, then start the next task." : "All three tasks complete.";

  return <section className="eye-module" aria-label="Eye movement tasks">
    <header className="eye-heading"><div><h2>Eye movement</h2><p>A short calibration, then three tasks. Your camera stays on this device.</p></div>
      <span className="eye-status" role="status">{cameraStatusText(controller.phase, controller.faceDetected)}</span></header>
    <p id={instructionId} className="eye-instructions">{schedule.instructions}</p>
    <div className="eye-stage"><canvas ref={canvasRef} width={960} height={540} aria-label="Eye movement target" aria-describedby={instructionId} />
      {controller.phase !== "running" && <p className="eye-stage-message">{stageMessage}</p>}
      {controller.phase === "running" && controller.headMoving && <p className="eye-stage-message eye-stage-hint" role="status">Keep your head still</p>}
      <video ref={controller.videoRef} width={160} height={120} autoPlay playsInline muted className="eye-video" aria-label="Mirrored camera preview" />
    </div>
    <div className="eye-progress"><progress value={controller.elapsedMs} max={schedule.durationMs} aria-label="Task progress" />
      <span>{(controller.elapsedMs / 1000).toFixed(1)} / {(schedule.durationMs / 1000).toFixed(0)} s</span></div>
    <div className="eye-actions"><button type="button" disabled={busy} onClick={() => { void run(controller.runCalibration); }}>
        {controller.calibrationStatus === "ok" ? "Recalibrate" : "Calibrate (10 s)"}</button>
      {(needsCalibration || controller.calibrationStatus === "failed") && <button type="button" disabled={busy} onClick={controller.skipCalibration}>Skip calibration</button>}
      <span className={`eye-status${controller.calibrationStatus === "ok" ? "" : " warn"}`} role="status">{calibrationStatusText(controller.calibrationStatus, controller.calibration)}</span></div>
    <div className="eye-actions">{EYE_TASK_ORDER.map((task, index) => <button key={task} type="button" disabled={busy || needsCalibration || task !== nextTask}
      onClick={() => { void run(() => controller.runTask(task)); }}>{index + 1}. {labels[task]}{controller.results.some(result => result.task === task) ? " (complete)" : ""}</button>)}</div>
    <div className="eye-actions"><button type="button" disabled={busy} onClick={speak}>Read instructions aloud</button>
      <button type="button" onClick={controller.cancel}>Stop camera</button>
      <button type="button" disabled={busy} onClick={() => { setActionError(null); controller.reset(); }}>Start over</button></div>
    {(controller.error || actionError) && <p className="eye-error" role="alert">{controller.error || actionError}</p>}
    {controller.results.length > 0 && <div className="eye-results">
      <h3>Results <span className="eye-band" style={{ color: `var(${meta.varName})`, background: `var(${meta.softVarName})` }}>{meta.label}</span></h3>
      <p>{resultsNote(summary)}</p>
      <div className="eye-table-scroll" tabIndex={0} role="region" aria-label="Eye results table"><table><caption>Local eye movement measurements</caption>
        <thead><tr><th scope="col">Task</th><th scope="col">Tracked</th><th scope="col">Saccades</th><th scope="col">Stability</th><th scope="col">Latency (ms)</th><th scope="col">Accuracy</th><th scope="col">Gain</th><th scope="col">Target error</th><th scope="col">Head motion (°)</th><th scope="col">Blinks/min</th></tr></thead>
        <tbody>{controller.results.map(result => <tr key={result.task}><th scope="row">{labels[result.task]}</th><td>{Math.round(result.trackingCoverage * 100)}%</td><td>{result.saccadeCount}</td><td>{display(result.fixationStability, 3)}</td><td>{display(result.meanSaccadeLatencyMs, 0)}</td><td>{display(result.saccadeAccuracy)}</td><td>{display(result.pursuitGain)}</td><td>{display(result.targetErrorRms, 3)}</td><td>{display(result.headMotionDeg, 1)}</td><td>{display(result.blinkRatePerMin, 1)}</td></tr>)}</tbody>
      </table></div>
    </div>}
  </section>;
}
