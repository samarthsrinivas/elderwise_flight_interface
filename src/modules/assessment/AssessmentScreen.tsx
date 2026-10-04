import { ASSESSMENT_STEPS, type AssessmentStep } from "./types";

const STEP_LABELS: Record<AssessmentStep, string> = {
  setup: "1. Setup",
  voice: "2. Voice",
  vitals: "3. Vitals",
  eye: "4. Eye Tracking",
  summary: "5. Summary",
};

export function AssessmentScreen() {
  return (
    <section className="screen">
      <h1>Guided Wellness Check-in</h1>
      <p className="lede">
        A fast, non-invasive check-in measuring voice acoustics, facial vitals (rPPG), and ocular saccades.
      </p>

      <div className="stepper" role="tablist" aria-label="Assessment steps">
        {ASSESSMENT_STEPS.map((step, idx) => (
          <div
            key={step}
            className={`stepper__step ${idx === 0 ? "active" : ""}`}
            role="tab"
            aria-selected={idx === 0}
          >
            <span className="stepper__step-index">{idx + 1}</span>
            <span>{STEP_LABELS[step]}</span>
          </div>
        ))}
      </div>

      <div className="panel" style={{ textAlign: "center", padding: "var(--space-8) var(--space-5)" }}>
        <h2 style={{ fontSize: "var(--text-xl)", marginBottom: "var(--space-2)" }}>
          Assessment Flow In Progress
        </h2>
        <p className="hint" style={{ maxWidth: "480px", margin: "0 auto var(--space-5)" }}>
          Assessment flow is being wired up with live audio recording, camera vitals rPPG tracking, and gaze calibration.
        </p>
        <button type="button" className="primary" disabled>
          Start Check-in (Wiring...)
        </button>
      </div>
    </section>
  );
}
