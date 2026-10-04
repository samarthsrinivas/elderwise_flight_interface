import { useEffect, useState } from "react";
import { toMessage } from "../../lib/errors";
import {
  downloadAgeWeights,
  fetchAgeModelStatus,
  type AgeModelStatus,
} from "../voice/age";

function badgeClass(ready: boolean): string {
  return ready ? "badge ok" : "badge warn";
}

function describeDependencies(status: AgeModelStatus): string {
  if (status.pythonPath === null) {
    return "Python environment not found (.venv-ml). See ml/README.md.";
  }
  if (!status.dependenciesOk) {
    return `Missing packages: ${status.missingDependencies.join(", ")}`;
  }
  return `${status.pythonVersion ?? "Python"} at ${status.pythonPath}`;
}

export function AgeModelPanel() {
  const [status, setStatus] = useState<AgeModelStatus | null>(null);
  const [busy, setBusy] = useState<"refresh" | "download" | null>(null);
  const [notice, setNotice] = useState<{ text: string; isError?: boolean } | null>(null);

  const refresh = async () => {
    setBusy("refresh");
    try {
      setStatus(await fetchAgeModelStatus());
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void fetchAgeModelStatus().then((loaded) => {
      if (!cancelled) setStatus(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDownload = async () => {
    setBusy("download");
    setNotice(null);
    try {
      const result = await downloadAgeWeights();
      setNotice({ text: `WavLM weights ready at ${result.weightsPath}` });
      setStatus(await fetchAgeModelStatus());
    } catch (err) {
      setNotice({ text: `Download failed: ${toMessage(err)}`, isError: true });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="panel" aria-label="Voice Age Model">
      <div className="age-model__header">
        <div>
          <h2>Voice Age Model</h2>
          <p className="hint">
            On-device WavLM + SVR regression (MLX). Estimates speaker age from the reading and
            free-speech tasks; typical error ±{(status?.maeYears ?? 7.6).toFixed(1)} years.
          </p>
        </div>
        <span className={status?.available ? "badge ok" : "badge warn"}>
          {status ? (status.available ? "Ready" : "Needs setup") : "Checking..."}
        </span>
      </div>

      {status && (
        <div className="ai-readiness">
          <div className="ai-readiness__item">
            <span className={badgeClass(status.dependenciesOk)}>Python / MLX</span>
            <span>{describeDependencies(status)}</span>
          </div>
          <div className="ai-readiness__item">
            <span className={badgeClass(status.weightsCached)}>WavLM weights</span>
            <span>
              {status.weightsCached
                ? "microsoft/wavlm-base-plus cached locally."
                : "Not downloaded yet (~377 MB from Hugging Face)."}
            </span>
          </div>
          <div className="ai-readiness__item">
            <span className={badgeClass(status.modelPresent)}>Age regressor</span>
            <span>
              {status.modelPresent
                ? `${status.model} at ${status.modelPath}`
                : `age_model.joblib not found${status.modelPath ? ` at ${status.modelPath}` : ""}. Train it with ml/train.py or copy it there.`}
            </span>
          </div>
          {status.detail && !status.available && (
            <p className="hint age-model__detail">{status.detail}</p>
          )}
        </div>
      )}

      {notice && <p className={notice.isError ? "error" : "hint"}>{notice.text}</p>}

      <div className="answer-row">
        <button
          type="button"
          className="secondary"
          onClick={() => void handleDownload()}
          disabled={busy !== null || status === null || status.pythonPath === null || status.weightsCached}
        >
          {busy === "download" ? "Downloading weights..." : "Download WavLM weights"}
        </button>
        <button type="button" className="secondary" onClick={() => void refresh()} disabled={busy !== null}>
          {busy === "refresh" ? "Checking..." : "Refresh"}
        </button>
      </div>
    </div>
  );
}
