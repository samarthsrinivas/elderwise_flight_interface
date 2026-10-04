import { useState } from "react";
import { toMessage } from "../../lib/errors";
import { clearProviderKey, fetchAiStatus, setProviderKey } from "./api";
import type { AiStatus, KeyProvider, KeySource, TestResult } from "./types";

type KeyFieldProps = {
  label: string;
  hint: string;
  source: KeySource;
  testing?: boolean;
  testResult?: TestResult | null;
  onTest?: () => void;
  revealable?: boolean;
  statusUnavailable?: boolean;
} & (
  | { provider: KeyProvider; onStatus: (status: AiStatus) => void }
  | { actions: { save: (key: string) => Promise<void>; clear: () => Promise<void>; refresh: () => Promise<void> } }
);

export function ProviderKeyField(props: KeyFieldProps) {
  const { label, hint, source, testing, testResult, onTest, revealable, statusUnavailable } = props;
  const [keyInput, setKeyInput] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      if ("actions" in props) await props.actions.save(keyInput.trim());
      else await setProviderKey(props.provider, keyInput.trim());
      setKeyInput("");
      setVisible(false);
      if ("actions" in props) await props.actions.refresh();
      else props.onStatus(await fetchAiStatus());
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    setError("");
    try {
      if ("actions" in props) {
        await props.actions.clear();
        setKeyInput("");
        setVisible(false);
        await props.actions.refresh();
      } else {
        await clearProviderKey(props.provider);
        props.onStatus(await fetchAiStatus());
      }
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const sourceLabels: Record<KeySource, string> = {
    keychain: "Stored in Keychain",
    env: "Environment Variable",
    local: "Local",
    none: "Not configured",
  };

  return (
    <div style={{ marginTop: "var(--space-3)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <h3 style={{ margin: 0 }}>{label}</h3>
        <span className={source !== "none" ? "badge ok" : "badge neutral"}>
          {statusUnavailable ? "Status unavailable" : sourceLabels[source]}
        </span>
      </div>
      <p className="hint">{hint}</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
          <span style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>API Key</span>
          <input
            type={visible ? "text" : "password"}
            autoComplete="off"
            disabled={busy}
            value={keyInput}
            placeholder={`Paste ${label} key here`}
            onChange={(event) => setKeyInput(event.target.value)}
            style={{ minWidth: "min(18rem, 100%)", maxWidth: "100%" }}
          />
        </label>
        <div className="answer-row" style={{ marginTop: "var(--space-2)" }}>
          <button
            type="button"
            className="primary"
            disabled={busy || keyInput.trim().length === 0}
            onClick={() => void save()}
          >
            {busy ? "Saving..." : "Save Key"}
          </button>
          {revealable && (
            <button type="button" className="secondary" disabled={busy}
              aria-label={`${visible ? "Hide" : "Show"} ${label} API key`}
              aria-pressed={visible} onClick={() => setVisible(!visible)}>
              {visible ? "Hide key" : "Show key"}
            </button>
          )}
          {source !== "none" && (!("actions" in props) || source === "keychain") && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void clear()}
            >
              Clear Key
            </button>
          )}
          {onTest && (
            <button
              type="button"
              className="secondary"
              disabled={busy || testing === true}
              onClick={onTest}
            >
              {testing === true ? "Testing..." : "Test"}
            </button>
          )}
        </div>
      </div>
      {testResult && (
        <p className={testResult.ok ? "hint" : "error"} style={{ marginTop: "var(--space-2)" }}>
          {testResult.detail}
          {testResult.models.length ? ` — models: ${testResult.models.join(", ")}` : ""}
        </p>
      )}
    </div>
  );
}
