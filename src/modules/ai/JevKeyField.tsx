import { useEffect, useState } from "react";
import { toMessage } from "../../lib/errors";
import { clearJevKey, fetchJevKeyStatus, setJevKey, type JevKeyStatus } from "./jevApi";
import { ProviderKeyField } from "./ProviderKeyField";

export function JevKeyField() {
  const [status, setStatus] = useState<JevKeyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetchJevKeyStatus()
      .then((next) => { if (!cancelled) setStatus(next); })
      .catch((raised) => { if (!cancelled) setError(toMessage(raised)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const refresh = async () => {
    try {
      const next = await fetchJevKeyStatus();
      setStatus(next);
      setError("");
    } catch (raised) {
      setStatus(null);
      throw raised;
    }
  };

  if (loading) return <p className="hint" role="status">Loading TypeSafe Jev key status...</p>;

  return (
    <>
      {error && <p className="error" role="alert">Could not check the Jev key: {error}</p>}
      <ProviderKeyField
        label="TypeSafe Jev"
        hint="Used for questionnaire decisions about subjective age. Model: jev-latest."
        source={status?.source === "environment" ? "env" : status?.source ?? "none"}
        revealable
        statusUnavailable={!status}
        actions={{ save: setJevKey, clear: clearJevKey, refresh }}
      />
      {status?.source === "environment" && (
        <p className="hint">An environment key is configured. Saving a key here will take precedence.</p>
      )}
    </>
  );
}
