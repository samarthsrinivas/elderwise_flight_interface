import { useEffect, useRef, useState } from "react";
import { toMessage } from "../../../lib/errors";
import {
  captureVoiceTask,
  isPermissionTranscriptError,
} from "../../voice/captureVoiceTask";
import { isSynthesisSupported, speak, stopSpeaking } from "../../voice/speech";
import { VOICE_TASKS, type VoiceTaskSpec } from "../../voice/tasks";
import type { VoiceTaskResult } from "../types";

export interface VoiceStepProps {
  readonly voiceTasks: readonly VoiceTaskResult[];
  readonly onCompleteTask: (result: VoiceTaskResult) => void;
  readonly onFinish: () => void;
  readonly onSkip: () => void;
  readonly onBack: () => void;
}

type TaskPhase = "idle" | "speaking" | "recording" | "analyzing" | "done" | "error";

export function VoiceStep({
  voiceTasks,
  onCompleteTask,
  onFinish,
  onSkip,
  onBack,
}: VoiceStepProps) {
  const [taskIndex, setTaskIndex] = useState(0);
  const [phase, setPhase] = useState<TaskPhase>("idle");
  const [audioLevel, setAudioLevel] = useState(0);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPermError, setIsPermError] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const timerRef = useRef<number | null>(null);

  const spec: VoiceTaskSpec = VOICE_TASKS[taskIndex] ?? VOICE_TASKS[0]!;
  const currentResult = voiceTasks.find((task) => task.task === spec.id);

  useEffect(() => {
    return () => {
      stopSpeaking();
      abortControllerRef.current?.abort();
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (currentResult && phase !== "recording" && phase !== "analyzing") {
      setPhase("done");
    } else if (!currentResult && phase === "done") {
      setPhase("idle");
    }
  }, [currentResult, phase]);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleReadAloud = async () => {
    setErrorMessage(null);
    setPhase("speaking");
    try {
      await speak(spec.instructions);
    } catch {
      // Ignored
    } finally {
      setPhase((prev) => (prev === "speaking" ? "idle" : prev));
    }
  };

  const handleStopReading = () => {
    stopSpeaking();
    setPhase("idle");
  };

  const handleStartRecording = async () => {
    stopSpeaking();
    setErrorMessage(null);
    setIsPermError(false);
    setPhase("recording");
    setSecondsRemaining(spec.durationS);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const startedAt = Date.now();
    timerRef.current = window.setInterval(() => {
      const elapsedS = (Date.now() - startedAt) / 1000;
      const left = Math.max(0, Math.ceil(spec.durationS - elapsedS));
      setSecondsRemaining(left);
    }, 100);

    try {
      const result = await captureVoiceTask(spec, {
        onLevel: (lvl) => setAudioLevel(lvl),
        signal: controller.signal,
      });
      clearTimer();
      setPhase("done");
      onCompleteTask(result);
    } catch (err) {
      clearTimer();
      if (controller.signal.aborted) {
        setPhase("idle");
        return;
      }
      const perm = isPermissionTranscriptError(err);
      setIsPermError(perm);
      setErrorMessage(
        perm
          ? "Microphone access is denied. On macOS, open System Settings > Privacy & Security > Microphone to grant permission."
          : toMessage(err),
      );
      setPhase("error");
    } finally {
      abortControllerRef.current = null;
      setAudioLevel(0);
    }
  };

  const handleCancelRecording = () => {
    abortControllerRef.current?.abort();
    clearTimer();
    setPhase("idle");
    setAudioLevel(0);
  };

  const handleNextTask = () => {
    if (taskIndex < VOICE_TASKS.length - 1) {
      setTaskIndex(taskIndex + 1);
      setPhase("idle");
      setErrorMessage(null);
    } else {
      onFinish();
    }
  };

  const handleRedo = () => {
    setPhase("idle");
    setErrorMessage(null);
  };

  const isLastTask = taskIndex === VOICE_TASKS.length - 1;

  return (
    <div className="voice-step">
      <div className="panel">
        <div className="step-task-header">
          <span className="badge neutral">
            Task {taskIndex + 1} of {VOICE_TASKS.length}
          </span>
          <h2>{spec.title}</h2>
        </div>
        <p className="hint" style={{ fontSize: "var(--text-md)", marginTop: "var(--space-2)" }}>
          {spec.instructions}
        </p>

        <div className="voice-prompt-box">
          <p className="voice-prompt-text">{spec.prompt}</p>
        </div>

        {phase === "recording" && (
          <div className="voice-live-meter-card">
            <div className="timer" aria-live="polite">
              00:{String(secondsRemaining).padStart(2, "0")}
            </div>
            <div className="voice-level-meter" role="progressbar" aria-valuenow={Math.round(audioLevel * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Microphone volume">
              <div
                className="voice-level-meter__fill"
                style={{ width: `${Math.min(100, Math.round(audioLevel * 100 * 3))}%` }}
              />
            </div>
            <p className="hint" style={{ textAlign: "center", margin: 0 }}>
              Listening... Speak toward your microphone.
            </p>
          </div>
        )}

        {phase === "error" && errorMessage && (
          <div className="panel" style={{ background: "var(--band-limited-soft)", border: "1px solid var(--band-limited)" }}>
            <p className="error" style={{ margin: 0 }}>{errorMessage}</p>
            {isPermError && (
              <p className="hint" style={{ marginTop: "var(--space-2)" }}>
                Tip: If you recently granted microphone permission, you may need to restart Elderwise.
              </p>
            )}
          </div>
        )}

        {phase === "done" && currentResult && (
          <div className="voice-results-summary">
            <h3>Task completed</h3>
            <div className="voice-chips-row">
              <span className="badge ok">Recorded: {currentResult.capture.durationS.toFixed(1)}s</span>
              <span className={`badge ${currentResult.capture.quality === "good" ? "ok" : "neutral"}`}>
                Quality: {currentResult.capture.quality}
              </span>
              {currentResult.markers.f0MeanHz !== null && (
                <span className="badge neutral">
                  Pitch (F0): {Math.round(currentResult.markers.f0MeanHz)} Hz
                </span>
              )}
            </div>
            {currentResult.transcript && (
              <p className="hint voice-transcript-preview">
                <strong>Transcript:</strong> &ldquo;{currentResult.transcript}&rdquo;
              </p>
            )}
          </div>
        )}

        <div className="answer-row" style={{ marginTop: "var(--space-5)" }}>
          {phase === "recording" ? (
            <button type="button" className="secondary" onClick={handleCancelRecording}>
              Cancel recording
            </button>
          ) : phase === "done" ? (
            <>
              <button type="button" className="primary" onClick={handleNextTask}>
                {isLastTask ? "Continue to vitals" : "Next voice task"}
              </button>
              <button type="button" className="secondary" onClick={handleRedo}>
                Redo recording
              </button>
            </>
          ) : (
            <>
              <button type="button" className="primary" onClick={() => void handleStartRecording()}>
                Start recording ({spec.durationS}s)
              </button>
              {isSynthesisSupported() && (
                phase === "speaking" ? (
                  <button type="button" className="secondary" onClick={handleStopReading}>
                    Stop reading
                  </button>
                ) : (
                  <button type="button" className="secondary" onClick={() => void handleReadAloud()}>
                    Read instructions aloud
                  </button>
                )
              )}
            </>
          )}

          <button
            type="button"
            className="secondary"
            onClick={onSkip}
            disabled={phase === "recording"}
            style={{ marginLeft: "auto" }}
          >
            Skip voice
          </button>
        </div>
      </div>

      <div className="answer-row" style={{ marginTop: "var(--space-3)" }}>
        <button type="button" className="secondary" onClick={onBack} disabled={phase === "recording"}>
          Back
        </button>
      </div>
    </div>
  );
}
