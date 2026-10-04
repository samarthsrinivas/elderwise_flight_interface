import { useEffect, useState } from "react";
import { isVoiceInputSupported } from "../../voice/captureVoiceTask";
import type { Participant } from "../types";

export interface SetupStepProps {
  readonly participant: Participant;
  readonly onStart: (participant: Participant) => void;
}

export function SetupStep({ participant, onStart }: SetupStepProps) {
  const [ageInput, setAgeInput] = useState<string>(
    participant.age !== null ? String(participant.age) : "",
  );
  const [sex, setSex] = useState<Participant["sex"]>(participant.sex);
  const [micSupported, setMicSupported] = useState<boolean>(true);
  const [cameraSupported, setCameraSupported] = useState<boolean>(true);

  useEffect(() => {
    setMicSupported(isVoiceInputSupported());
    const hasCam = typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
    setCameraSupported(hasCam);
  }, []);

  const parsedAge = ageInput.trim() === "" ? null : Number.parseInt(ageInput, 10);
  const isAgeValid = parsedAge === null || (!Number.isNaN(parsedAge) && parsedAge >= 18 && parsedAge <= 120);

  const handleStart = () => {
    if (!isAgeValid) return;
    onStart({
      age: parsedAge,
      sex,
    });
  };

  return (
    <div className="setup-step">
      <div className="panel">
        <h2>Welcome to your Elderwise Check-in</h2>
        <p className="hint" style={{ fontSize: "var(--text-md)", lineHeight: 1.6, marginTop: "var(--space-2)" }}>
          This guided check-in gathers wellness indicators from three quick, gentle exercises. The entire session takes approximately 3 minutes.
        </p>

        <div className="setup-modules-grid">
          <div className="setup-module-card">
            <div className="setup-module-card__header">
              <span className="setup-module-card__index">1</span>
              <h3>Voice Acoustics</h3>
            </div>
            <p>A sustained vowel sound, reading a short passage, and brief spontaneous speech (~1 min).</p>
          </div>

          <div className="setup-module-card">
            <div className="setup-module-card__header">
              <span className="setup-module-card__index">2</span>
              <h3>Facial Vitals</h3>
            </div>
            <p>Rest comfortably facing the camera for 30 seconds to estimate resting heart and breathing rates.</p>
          </div>

          <div className="setup-module-card">
            <div className="setup-module-card__header">
              <span className="setup-module-card__index">3</span>
              <h3>Eye Movement</h3>
            </div>
            <p>Follow a moving dot on the screen to measure gaze fixation, jump reactions, and smooth tracking (~1 min).</p>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Device Readiness</h2>
        <p className="hint">We check for microphone and camera support before starting.</p>
        <div className="provider-status-grid" style={{ marginTop: "var(--space-3)" }}>
          <div className="provider-status">
            <span>Microphone</span>
            <span className={`badge ${micSupported ? "ok" : "warn"}`}>
              {micSupported ? "Ready" : "Unavailable"}
            </span>
          </div>
          <div className="provider-status">
            <span>Camera</span>
            <span className={`badge ${cameraSupported ? "ok" : "warn"}`}>
              {cameraSupported ? "Ready" : "Unavailable"}
            </span>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Participant Information (Optional)</h2>
        <p className="hint">Age and sex help benchmark biomarkers against healthy aging population curves.</p>

        <div className="setup-form-grid">
          <div className="setup-form-field">
            <label htmlFor="participant-age">
              Age <span className="hint">(years, 18–120)</span>
            </label>
            <input
              id="participant-age"
              type="number"
              min={18}
              max={120}
              placeholder="e.g. 74"
              value={ageInput}
              onChange={(e) => setAgeInput(e.target.value)}
              aria-invalid={!isAgeValid}
            />
            {!isAgeValid && (
              <p className="error" style={{ marginTop: "var(--space-1)" }}>
                Please enter a valid age between 18 and 120, or leave blank.
              </p>
            )}
          </div>

          <div className="setup-form-field">
            <label htmlFor="participant-sex">Sex</label>
            <select
              id="participant-sex"
              value={sex}
              onChange={(e) => setSex(e.target.value as Participant["sex"])}
            >
              <option value="unspecified">Unspecified / Prefer not to say</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
            </select>
          </div>
        </div>

        <div className="setup-privacy-banner">
          <p className="hint" style={{ margin: 0 }}>
            <strong>Privacy notice:</strong> Audio clips go to the configured cloud speech provider for transcription/voice; everything else is computed on this device.
          </p>
        </div>

        <div className="answer-row" style={{ marginTop: "var(--space-6)" }}>
          <button
            type="button"
            className="primary"
            onClick={handleStart}
            disabled={!isAgeValid}
            style={{ minWidth: "200px" }}
          >
            Start check-in
          </button>
        </div>
      </div>
    </div>
  );
}
