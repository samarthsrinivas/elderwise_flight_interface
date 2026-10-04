import { useEffect, useState } from "react";
import { fetchAiStatus } from "./api";
import { buildAiReadiness } from "./readiness";
import type { AiStatus } from "./types";

function badgeClass(ready: boolean): string {
  return ready ? "badge ok" : "badge warn";
}

export function AiReadinessPanel() {
  const [status, setStatus] = useState<AiStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchAiStatus().then((next) => {
      if (!cancelled) setStatus(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === null) return null;

  const readiness = buildAiReadiness(status);

  return (
    <div className="ai-readiness" aria-label="AI Provider Readiness">
      <strong>AI Status & Readiness</strong>
      <div className="ai-readiness__item">
        <span className={badgeClass(readiness.speechToTextReady)}>Transcription</span>
        <span>{readiness.speechToTextMessage}</span>
      </div>
      <div className="ai-readiness__item">
        <span className={badgeClass(readiness.summaryReady)}>Summary</span>
        <span>{readiness.summaryMessage}</span>
      </div>
      <div className="ai-readiness__item">
        <span className={badgeClass(readiness.voiceOutputReady)}>Voice Output</span>
        <span>{readiness.voiceOutputMessage}</span>
      </div>
    </div>
  );
}
