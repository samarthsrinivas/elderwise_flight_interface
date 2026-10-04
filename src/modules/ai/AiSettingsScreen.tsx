import { useEffect, useRef, useState } from "react";
import { toMessage } from "../../lib/errors";
import {
  fetchAiStatus,
  getAiSettings,
  setAiSettings,
  testProvider,
} from "./api";
import { ProviderKeyField } from "./ProviderKeyField";
import { JevKeyField } from "./JevKeyField";
import { summarizeAiStatus, type AiCapabilitySummary } from "./statusSummary";
import {
  defaultAiSettings,
  type AiSettings,
  type AiStatus,
  type AsrProvider,
  type ChatProvider,
  type KeyProvider,
  type TestResult,
  type TestableProvider,
  type VoiceProvider,
} from "./types";

type ModelSettingKey =
  | "elevenlabsVoiceId"
  | "elevenlabsAsrModel"
  | "openaiAsrModel"
  | "openaiChatModel"
  | "elevenlabsTtsModel";

const DEFAULTS = defaultAiSettings();

const ASR_OPTIONS: { value: AsrProvider; label: string }[] = [
  { value: "elevenlabs", label: "ElevenLabs Scribe" },
  { value: "openai", label: "OpenAI" },
  { value: "off", label: "Off" },
];

const CHAT_OPTIONS: { value: ChatProvider; label: string }[] = [
  { value: "openai", label: "OpenAI" },
  { value: "off", label: "Off" },
];

const VOICE_OPTIONS: { value: VoiceProvider; label: string }[] = [
  { value: "elevenlabs", label: "ElevenLabs" },
  { value: "system", label: "System Voice" },
];

function statusBadgeClass(row: AiCapabilitySummary): string {
  if (row.state === "active") return "badge ok";
  if (row.state === "needs_setup") return "badge warn";
  return "badge neutral";
}

function ModelField({
  label,
  settingKey,
  settings,
  onChange,
  onCommit,
}: {
  label: string;
  settingKey: ModelSettingKey;
  settings: AiSettings;
  onChange: (next: AiSettings) => void;
  onCommit: (next: AiSettings) => void;
}) {
  const value = settings[settingKey];
  const fallback = DEFAULTS[settingKey];
  const isDefault = value.trim() === fallback;
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
      <span style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>{label}</span>
      <div className="answer-row" style={{ marginTop: 0 }}>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange({ ...settings, [settingKey]: e.target.value })}
          onBlur={() => onCommit(settings)}
          style={{ minWidth: "min(18rem, 100%)" }}
        />
        {!isDefault && (
          <button
            type="button"
            className="secondary"
            onClick={() => onCommit({ ...settings, [settingKey]: fallback })}
          >
            Use default
          </button>
        )}
      </div>
      <span className="hint">
        {isDefault ? `Default: ${fallback}` : `Default is ${fallback}`}
      </span>
    </label>
  );
}

export function AiSettingsScreen() {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [testResult, setTestResult] = useState<{
    provider: TestableProvider;
    result: TestResult;
  } | null>(null);
  const [testingProvider, setTestingProvider] = useState<TestableProvider | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void Promise.all([getAiSettings(), fetchAiStatus()])
      .then(([loadedSettings, loadedStatus]) => {
        if (cancelled) return;
        setSettings(loadedSettings);
        setStatus(loadedStatus);
      })
      .catch((raised) => {
        if (!cancelled) setError(toMessage(raised));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const applySeq = useRef(0);

  const apply = (next: AiSettings) => {
    setSettings(next);
    setError("");
    const seq = applySeq.current + 1;
    applySeq.current = seq;
    queueRef.current = queueRef.current.then(async () => {
      try {
        const saved = await setAiSettings(next);
        if (applySeq.current === seq) {
          setSettings(saved);
          const freshStatus = await fetchAiStatus();
          setStatus(freshStatus);
        }
      } catch (raised) {
        if (applySeq.current === seq) setError(toMessage(raised));
      }
    });
  };

  const runProviderTest = async (provider: TestableProvider) => {
    if (!settings) return;
    setTestingProvider(provider);
    setTestResult(null);
    setError("");
    try {
      const result = await testProvider(provider);
      setTestResult({ provider, result });
    } catch (raised) {
      setError(toMessage(raised));
    } finally {
      setTestingProvider(null);
    }
  };

  const providerTestResult = (provider: TestableProvider) =>
    testResult?.provider === provider ? testResult.result : null;

  const keyTestProps = (provider: KeyProvider) => ({
    testing: testingProvider === provider,
    testResult: providerTestResult(provider),
    onTest: () => void runProviderTest(provider),
  });

  if (!settings) {
    return (
      <section className="screen">
        <h1>AI Settings</h1>
        {error ? <p className="error">{error}</p> : <p className="hint">Loading settings...</p>}
      </section>
    );
  }

  return (
    <section className="screen">
      <h1>AI & Cloud Settings</h1>
      <p className="lede">
        Configure cloud providers for speech transcription, spoken voice prompts, and assessment summaries.
      </p>
      {error && <p className="error">{error}</p>}

      {status && (
        <div className="panel">
          <h2>Active Capabilities</h2>
          <p className="hint">Current status of cloud AI services across Elderwise.</p>
          <div className="ai-active-grid">
            {summarizeAiStatus(status).map((row) => (
              <div className="ai-active-status" key={row.id}>
                <div className="ai-active-status__head">
                  <strong>{row.name}</strong>
                  <span className={statusBadgeClass(row)}>
                    {row.state === "active" ? "Active" : row.state === "off" ? "Off" : "Setup needed"}
                  </span>
                </div>
                <span>{row.provider}</span>
                {row.details.map((detail) => (
                  <span className="ai-active-status__detail" key={detail}>
                    {detail}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="panel">
        <h2>API Keys</h2>
        <p className="hint">
          Keys are stored in the macOS Keychain and never leave this device except to call the provider.
        </p>

        {status && (
          <>
            <ProviderKeyField
              provider="openai"
              label="OpenAI"
              hint="Required for GPT-6.1 Sol summaries and optional transcription."
              source={status.keys.openai.source}
              onStatus={setStatus}
              {...keyTestProps("openai")}
            />
            <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "var(--space-4) 0" }} />
            <ProviderKeyField
              provider="elevenlabs"
              label="ElevenLabs"
              hint="Required for Scribe transcription and natural voice prompts."
              source={status.keys.elevenlabs.source}
              onStatus={setStatus}
              {...keyTestProps("elevenlabs")}
            />
          </>
        )}
        <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "var(--space-4) 0" }} />
        <JevKeyField />
      </div>

      <div className="panel">
        <h2>Speech-to-Text (Transcription)</h2>
        <p className="hint">Select the provider used to transcribe spoken answers during the voice check-in.</p>
        <div className="answer-row" role="radiogroup" aria-label="Speech-to-text provider">
          {ASR_OPTIONS.map((option) => (
            <label key={option.value} style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}>
              <input
                type="radio"
                name="asr-provider"
                checked={settings.asrProvider === option.value}
                onChange={() => apply({ ...settings, asrProvider: option.value })}
              />{" "}
              {option.label}
            </label>
          ))}
        </div>

        {settings.asrProvider === "elevenlabs" && (
          <div style={{ marginTop: "var(--space-3)" }}>
            <ModelField
              label="ElevenLabs ASR Model"
              settingKey="elevenlabsAsrModel"
              settings={settings}
              onChange={setSettings}
              onCommit={apply}
            />
          </div>
        )}

        {settings.asrProvider === "openai" && (
          <div style={{ marginTop: "var(--space-3)" }}>
            <ModelField
              label="OpenAI ASR Model"
              settingKey="openaiAsrModel"
              settings={settings}
              onChange={setSettings}
              onCommit={apply}
            />
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Assessment Summary</h2>
        <p className="hint">Generate a plain-language summary report using an LLM.</p>
        <div className="answer-row" role="radiogroup" aria-label="Chat provider for summaries">
          {CHAT_OPTIONS.map((option) => (
            <label key={option.value} style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}>
              <input
                type="radio"
                name="chat-provider"
                checked={settings.chatProvider === option.value}
                onChange={() => apply({ ...settings, chatProvider: option.value })}
              />{" "}
              {option.label}
            </label>
          ))}
        </div>

        {settings.chatProvider === "openai" && (
          <div style={{ marginTop: "var(--space-3)" }}>
            <ModelField
              label="OpenAI Chat Model"
              settingKey="openaiChatModel"
              settings={settings}
              onChange={setSettings}
              onCommit={apply}
            />
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Spoken Prompts (Voice Output)</h2>
        <p className="hint">Choose how guided instructions are spoken aloud to the participant.</p>
        <div className="answer-row" role="radiogroup" aria-label="Voice output provider">
          {VOICE_OPTIONS.map((option) => (
            <label key={option.value} style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}>
              <input
                type="radio"
                name="voice-provider"
                checked={settings.voiceProvider === option.value}
                onChange={() => apply({ ...settings, voiceProvider: option.value })}
              />{" "}
              {option.label}
            </label>
          ))}
        </div>

        {settings.voiceProvider === "elevenlabs" && (
          <div style={{ display: "grid", gap: "var(--space-3)", marginTop: "var(--space-3)" }}>
            <ModelField
              label="ElevenLabs Voice ID"
              settingKey="elevenlabsVoiceId"
              settings={settings}
              onChange={setSettings}
              onCommit={apply}
            />
            <ModelField
              label="ElevenLabs TTS Model"
              settingKey="elevenlabsTtsModel"
              settings={settings}
              onChange={setSettings}
              onCommit={apply}
            />
          </div>
        )}
      </div>
    </section>
  );
}
