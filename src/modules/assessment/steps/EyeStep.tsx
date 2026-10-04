import { useState } from "react";
import { EyeTaskCanvas } from "../../eye/EyeTaskCanvas";
import { useEyeTracking } from "../../eye/useEyeTracking";
import type { EyeResult } from "../types";

export interface EyeStepProps {
  readonly eye: EyeResult | null;
  readonly onComplete: (result: EyeResult) => void;
  readonly onSkip: () => void;
  readonly onBack: () => void;
}

export function EyeStep({
  eye,
  onComplete,
  onSkip,
  onBack,
}: EyeStepProps) {
  // useEyeTracking releases the camera on unmount itself. Do not add a
  // cleanup effect keyed on `controller` here: it is a new object every render,
  // so the cleanup would cancel the task as soon as runTask() sets state.
  const controller = useEyeTracking();
  const [recordedResult, setRecordedResult] = useState<EyeResult | null>(eye);

  const handleAllDone = (result: EyeResult) => {
    setRecordedResult(result);
  };

  const handleContinue = () => {
    if (recordedResult) {
      onComplete(recordedResult);
    }
  };

  const isBusy = ["requesting", "loading-model", "running", "analyzing"].includes(
    controller.phase,
  );
  const isAllDone = recordedResult !== null || controller.results.length >= 3;

  return (
    <div className="eye-step">
      <div className="panel" style={{ marginBottom: "var(--space-4)" }}>
        <h2>Eye Movement Tracking</h2>
        <p className="hint" style={{ fontSize: "var(--text-md)", lineHeight: 1.6, margin: "var(--space-2) 0 0" }}>
          Keep your head still and follow the on-screen target with your eyes. There are three short exercises measuring fixation stability, jump reactions (saccades), and smooth tracking.
        </p>
      </div>

      <EyeTaskCanvas controller={controller} onAllDone={handleAllDone} />

      <div className="panel">
        <div className="answer-row">
          {isAllDone && (
            <button
              type="button"
              className="primary"
              onClick={handleContinue}
              disabled={isBusy}
            >
              Continue to summary
            </button>
          )}

          <button
            type="button"
            className="secondary"
            onClick={onSkip}
            disabled={isBusy}
            style={{ marginLeft: "auto" }}
          >
            Skip eye tracking
          </button>
        </div>

        <div className="answer-row" style={{ marginTop: "var(--space-3)" }}>
          <button
            type="button"
            className="secondary"
            onClick={onBack}
            disabled={isBusy}
          >
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
