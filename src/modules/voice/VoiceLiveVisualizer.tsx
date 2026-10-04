import React, { useEffect, useRef } from "react";
import "./voiceViz.css";

export interface VoiceLiveVisualizerProps {
  readonly phase: "recording" | "analyzing";
  readonly waveformRef: React.RefObject<Float32Array | null>;
  readonly level: number;
  readonly secondsRemaining: number;
  readonly durationS: number;
  readonly estimatesAge: boolean;
}

const RING_RADIUS = 68;
const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function VoiceLiveVisualizer({
  phase,
  waveformRef,
  level,
  secondsRemaining,
  durationS,
  estimatesAge,
}: VoiceLiveVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const clampedLevel = Math.max(0, Math.min(1, level));
  const levelLabel: "Quiet" | "Good" | "Loud" =
    clampedLevel < 0.08 ? "Quiet" : clampedLevel < 0.6 ? "Good" : "Loud";

  // dash-offset math: offset decreases from circumference to 0 as progress increases (filling the ring)
  const isAnalyzing = phase === "analyzing";
  const progress = isAnalyzing
    ? 1
    : durationS > 0
      ? Math.min(1, Math.max(0, (durationS - secondsRemaining) / durationS))
      : 0;
  const strokeDashoffset = CIRCUMFERENCE * (1 - progress);

  const drawWaveform = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    if (w <= 0 || h <= 0) return;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const cy = h / 2;

    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(w, cy);
    ctx.strokeStyle = "rgba(14, 165, 164, 0.22)";
    ctx.lineWidth = 1;
    ctx.stroke();

    const samples = waveformRef.current;
    if (samples && samples.length > 0) {
      ctx.beginPath();
      ctx.lineWidth = 2.5;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.strokeStyle = "#0ea5a4";

      const maxAmp = (h / 2) * 0.85;
      const step = samples.length / w;
      for (let x = 0; x < w; x++) {
        const idx = Math.min(samples.length - 1, Math.floor(x * step));
        const sample = Math.max(-1, Math.min(1, samples[idx] ?? 0));
        const y = cy - sample * maxAmp;
        if (x === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }
    ctx.restore();
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const updateSize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      const width = Math.floor(rect.width) || 540;
      const height = 130;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      drawWaveform();
    };

    updateSize();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        updateSize();
      });
      observer.observe(canvas);
      return () => observer.disconnect();
    }
  }, []);

  useEffect(() => {
    if (phase !== "recording") {
      drawWaveform();
      return;
    }

    let animationFrameId: number;
    let frameCount = 0;
    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const loop = () => {
      frameCount++;
      if (!reducedMotion || frameCount % 3 === 0) {
        drawWaveform();
      }
      animationFrameId = window.requestAnimationFrame(loop);
    };

    animationFrameId = window.requestAnimationFrame(loop);
    return () => {
      if (animationFrameId) {
        window.cancelAnimationFrame(animationFrameId);
      }
    };
  }, [phase]);

  return (
    <div className="voice-viz-card">
      <div className="voice-viz-meter-zone">
        <div
          className="voice-viz-halo"
          style={{
            transform: `scale(${1 + clampedLevel * 0.22})`,
            opacity: phase === "recording" ? 0.25 + clampedLevel * 0.6 : 0,
          }}
          aria-hidden="true"
        />
        <svg
          className="voice-viz-ring"
          viewBox="0 0 160 160"
          width="160"
          height="160"
          aria-hidden="true"
        >
          <circle
            className="voice-viz-ring__track"
            cx="80"
            cy="80"
            r={RING_RADIUS}
          />
          <circle
            className="voice-viz-ring__fill"
            cx="80"
            cy="80"
            r={RING_RADIUS}
            strokeDasharray={CIRCUMFERENCE}
            style={{ strokeDashoffset }}
          />
        </svg>
        <div className="voice-viz-timer-center">
          <span className="voice-viz-timer" aria-live="polite">
            {`00:${String(secondsRemaining).padStart(2, "0")}`}
          </span>
        </div>
      </div>

      {phase === "recording" && (
        <div className="voice-viz-level-row">
          <span className="voice-viz-level-label">Volume:</span>
          <span
            className={`voice-viz-level-badge voice-viz-level-badge--${levelLabel.toLowerCase()}`}
          >
            {levelLabel}
          </span>
        </div>
      )}

      {isAnalyzing && (
        <div
          className="voice-viz-analyzing-section"
          role="status"
          aria-live="polite"
        >
          <h3 className="voice-viz-analyzing-title">Analyzing your voice…</h3>
          <div className="voice-viz-progress-list">
            <div className="voice-viz-progress-row">
              <span className="voice-viz-progress-label">Transcribing</span>
              <div
                className="voice-viz-progress-track"
                role="progressbar"
                aria-label="Transcribing voice audio"
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="voice-viz-progress-bar" />
              </div>
            </div>
            {estimatesAge && (
              <div className="voice-viz-progress-row">
                <span className="voice-viz-progress-label">
                  Estimating voice age
                </span>
                <div
                  className="voice-viz-progress-track"
                  role="progressbar"
                  aria-label="Estimating voice age"
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div className="voice-viz-progress-bar" />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="voice-viz-canvas-wrapper">
        <canvas
          ref={canvasRef}
          className={
            isAnalyzing
              ? "voice-viz-canvas voice-viz-canvas--faded"
              : "voice-viz-canvas"
          }
          aria-label={
            phase === "recording"
              ? "Live microphone waveform"
              : "Voice waveform recording"
          }
          role="img"
        />
      </div>

      {phase === "recording" && (
        <p className="voice-viz-hint">
          Listening… speak toward your microphone.
        </p>
      )}
    </div>
  );
}
