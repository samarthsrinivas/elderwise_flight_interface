import { useCallback, useEffect, useRef, useState } from "react";
import { toMessage } from "../../../lib/errors";
import { isVoiceInputSupported } from "../../voice/captureVoiceTask";
import type { Participant } from "../types";

export interface SetupStepProps {
  readonly participant: Participant;
  readonly onStart: (participant: Participant) => void;
}

type CameraCheck =
  | { readonly status: "untested" | "testing" | "stalled" | "unavailable"; readonly detail: string | null }
  | { readonly status: "live"; readonly detail: string }
  | { readonly status: "blocked"; readonly detail: string; readonly hint: string };

const CAMERA_STALL_MS = 10_000;
const CAMERA_SETTINGS_HINT = "Open System Settings → Privacy & Security → Camera, switch on Elderwise, then quit and reopen the app.";

const cameraHint = (name: string): string => {
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return `macOS blocked camera access for Elderwise. ${CAMERA_SETTINGS_HINT}`;
    case "NotFoundError":
    case "OverconstrainedError":
      return "No usable camera was found. Connect or enable a camera and try again.";
    case "NotReadableError":
    case "AbortError":
      return "The camera could not start. Close other apps that may be using it (FaceTime, Zoom, Photo Booth) and try again.";
    default:
      return CAMERA_SETTINGS_HINT;
  }
};

const cameraBadge = (check: CameraCheck, supported: boolean): { readonly tone: string; readonly label: string } => {
  if (!supported || check.status === "unavailable") return { tone: "warn", label: "Unavailable" };
  switch (check.status) {
    case "live": return { tone: "ok", label: "Live" };
    case "blocked": return { tone: "warn", label: "Blocked" };
    case "testing": return { tone: "neutral", label: "Testing…" };
    case "stalled": return { tone: "neutral", label: "Waiting…" };
    default: return { tone: "ok", label: "Ready" };
  }
};

export function SetupStep({ participant, onStart }: SetupStepProps) {
  const [ageInput, setAgeInput] = useState<string>(
    participant.age !== null ? String(participant.age) : "",
  );
  const [sex, setSex] = useState<Participant["sex"]>(participant.sex);
  const [micSupported, setMicSupported] = useState<boolean>(true);
  const [cameraSupported, setCameraSupported] = useState<boolean>(true);
  const [cameraCheck, setCameraCheck] = useState<CameraCheck>({ status: "untested", detail: null });
  const previewRef = useRef<HTMLVideoElement>(null);
  const previewStream = useRef<MediaStream | null>(null);
  // Bumped on every stop/start so a late getUserMedia result from an abandoned test is discarded.
  const testGeneration = useRef(0);

  useEffect(() => {
    setMicSupported(isVoiceInputSupported());
    const hasCam = typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
    setCameraSupported(hasCam);
  }, []);

  const stopCamera = useCallback(() => {
    testGeneration.current += 1;
    previewStream.current?.getTracks().forEach(track => track.stop());
    previewStream.current = null;
    if (previewRef.current) previewRef.current.srcObject = null;
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  const testCamera = async () => {
    stopCamera();
    const generation = testGeneration.current;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setCameraCheck({ status: "unavailable", detail: "Camera access is unavailable in this environment." });
      return;
    }
    setCameraCheck({ status: "testing", detail: null });
    const stallTimer = window.setTimeout(() => {
      if (generation === testGeneration.current) {
        setCameraCheck({ status: "stalled", detail: `No answer from macOS after ${CAMERA_STALL_MS / 1000} s. If a permission dialog is open, choose Allow. ${CAMERA_SETTINGS_HINT}` });
      }
    }, CAMERA_STALL_MS);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      window.clearTimeout(stallTimer);
      if (generation !== testGeneration.current) { stream.getTracks().forEach(track => track.stop()); return; }
      previewStream.current = stream;
      const track = stream.getVideoTracks()[0];
      const settings = track?.getSettings();
      const size = settings?.width && settings?.height ? `${settings.width}×${settings.height}` : null;
      const detail = [track?.label || "Camera", size].filter((part): part is string => part !== null).join(" · ");
      const video = previewRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play();
      }
      if (generation !== testGeneration.current) return;
      setCameraCheck({ status: "live", detail });
    } catch (raised: unknown) {
      window.clearTimeout(stallTimer);
      if (generation !== testGeneration.current) return;
      const name = raised instanceof DOMException ? raised.name : raised instanceof Error ? raised.name : "Error";
      setCameraCheck({ status: "blocked", detail: `${name}: ${toMessage(raised) || "no details from the system"}`, hint: cameraHint(name) });
    }
  };

  const badge = cameraBadge(cameraCheck, cameraSupported);
  const cameraBusy = cameraCheck.status === "testing" || cameraCheck.status === "stalled";

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
        <p className="hint">We check for microphone and camera support before starting. Press Test camera to confirm macOS lets Elderwise use it.</p>
        <div className="provider-status-grid" style={{ marginTop: "var(--space-3)" }}>
          <div className="provider-status">
            <span>Microphone</span>
            <span className={`badge ${micSupported ? "ok" : "warn"}`}>
              {micSupported ? "Ready" : "Unavailable"}
            </span>
          </div>
          <div className="provider-status">
            <span>Camera</span>
            <span className={`badge ${badge.tone}`} role="status">{badge.label}</span>
          </div>
        </div>
        <div className="answer-row" style={{ marginTop: "var(--space-3)", alignItems: "flex-start" }}>
          <button type="button" className="secondary" onClick={() => { void testCamera(); }} disabled={!cameraSupported || cameraBusy}>
            Test camera
          </button>
          {cameraCheck.status === "live" && (
            <button type="button" className="secondary" onClick={() => { stopCamera(); setCameraCheck({ status: "untested", detail: null }); }}>
              Stop camera
            </button>
          )}
          <video
            ref={previewRef}
            autoPlay
            playsInline
            muted
            hidden={cameraCheck.status !== "live"}
            aria-label="Mirrored camera preview"
            style={{ width: 160, height: 120, objectFit: "cover", borderRadius: "var(--radius-sm)", transform: "scaleX(-1)", background: "var(--surface-muted)" }}
          />
        </div>
        {cameraCheck.detail && (
          <p className={cameraCheck.status === "live" ? "hint" : "error"} style={{ marginTop: "var(--space-2)" }} role={cameraCheck.status === "live" ? undefined : "alert"}>
            {cameraCheck.status === "live" ? `Live · ${cameraCheck.detail}` : cameraCheck.detail}
          </p>
        )}
        {cameraCheck.status === "blocked" && <p className="hint" style={{ marginTop: "var(--space-1)" }}>{cameraCheck.hint}</p>}
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
