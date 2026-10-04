export interface PulseTraceProps {
  readonly trace: readonly number[];
  readonly faceDetected: boolean;
  readonly label?: string;
}

const WIDTH = 320;
const HEIGHT = 96;
const PAD_Y = 12;
const MID_Y = HEIGHT / 2;
const AMP_Y = MID_Y - PAD_Y;

export function PulseTrace({ trace, faceDetected, label }: PulseTraceProps) {
  const hasData = trace.length > 1;
  const emptyMessage = !faceDetected
    ? "Hold still, face not detected"
    : "Finding your pulse…";
  const defaultLabel = hasData
    ? "Live pulse waveform"
    : "Waiting for pulse signal";
  const ariaLabel = label ?? defaultLabel;

  const pathD = hasData
    ? trace
        .map((val, i) => {
          const x = ((i / (trace.length - 1)) * WIDTH).toFixed(1);
          const clamped = Math.max(-1, Math.min(1, val));
          const y = (MID_Y - clamped * AMP_Y).toFixed(1);
          return `${i === 0 ? "M" : "L"}${x},${y}`;
        })
        .join(" ")
    : "";

  return (
    <div className="vitals-trace-card">
      <div className="vitals-trace-meta">
        <span className="vitals-trace-heading">Pulse waveform</span>
        <span
          className={`vitals-trace-badge ${hasData ? "is-live" : ""}`}
          aria-hidden="true"
        >
          {hasData ? "Live" : "Waiting"}
        </span>
      </div>
      <div className="vitals-trace-canvas">
        <svg
          className="vitals-trace-svg"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={ariaLabel}
        >
          <title>{ariaLabel}</title>
          <line
            x1={0}
            y1={MID_Y}
            x2={WIDTH}
            y2={MID_Y}
            className="vitals-trace-midline"
            vectorEffect="non-scaling-stroke"
          />
          {hasData && (
            <path
              d={pathD}
              className={`vitals-trace-path ${hasData ? "is-active" : "is-empty"}`}
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {!hasData && (
          <p className="vitals-trace-empty-text" aria-hidden="true">
            {emptyMessage}
          </p>
        )}
      </div>
    </div>
  );
}
