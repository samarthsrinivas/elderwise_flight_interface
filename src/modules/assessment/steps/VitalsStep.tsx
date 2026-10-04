import { useEffect, useState } from "react";
import { useVitalsCapture } from "../../vitals/useVitalsCapture";
import { VitalsPanel } from "../../vitals/VitalsPanel";
import type { VitalsResult } from "../types";

export interface VitalsStepProps {
  readonly vitals: VitalsResult | null;
  readonly onComplete: (result: VitalsResult) => void;
  readonly onSkip: () => void;
  readonly onBack: () => void;
}

export function VitalsStep({
  vitals,
  onComplete,
  onSkip,
  onBack,
}: VitalsStepProps) {
  const controller = useVitalsCapture({ durationS: 30 });
  const [recordedResult, setRecordedResult] = useState<VitalsResult | null>(vitals);

  useEffect(() => {
    return () => {
      controller.cancel();
    };
  }, [controller]);

  const handleComplete = (result: VitalsResult) => {
    setRecordedResult(result);
  };

  const handleContinue = () => {
    const finalResult = recordedResult ?? controller.result;
    if (finalResult) {
      onComplete(finalResult);
    }
  };

  const isBusy = ["requesting", "loading-model", "capturing", "analyzing"].includes(
    controller.phase,
  );
  const hasResult = recordedResult !== null || (controller.phase === "done" && controller.result !== null);

  return (
    <div className="vitals-step">
      <div className="panel" style={{ marginBottom: "var(--space-4)" }}>
        <h2>Facial Vitals Check (rPPG)</h2>
        <p className="hint" style={{ fontSize: "var(--text-md)", lineHeight: 1.6, margin: "var(--space-2) 0 0" }}>
          Sit comfortably facing your screen in even light. Breathe naturally and keep your head still for 30 seconds. Video analysis is performed entirely on this device.
        </p>
      </div>

      <VitalsPanel controller={controller} onComplete={handleComplete} />

      <div className="panel">
        <div className="answer-row">
          {hasResult && (
            <button
              type="button"
              className="primary"
              onClick={handleContinue}
              disabled={isBusy}
            >
              Continue to eye tracking
            </button>
          )}

          <button
            type="button"
            className="secondary"
            onClick={onSkip}
            disabled={isBusy}
            style={{ marginLeft: "auto" }}
          >
            Skip vitals
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
