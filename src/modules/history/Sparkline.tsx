import { bandMeta } from "../../ui/bandColor";
import type { TrendPoint } from "./useHistory";

interface SparklineProps {
  points: readonly TrendPoint[];
  label: string;
}

const WIDTH = 240;
const HEIGHT = 72;
const PAD = 8;

function positions(points: readonly TrendPoint[]): { x: number; y: number }[] {
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step =
    points.length > 1 ? (WIDTH - PAD * 2) / (points.length - 1) : 0;
  return points.map((p, i) => ({
    x: points.length > 1 ? PAD + i * step : WIDTH / 2,
    y: HEIGHT - PAD - ((p.value - min) / span) * (HEIGHT - PAD * 2),
  }));
}

/** Band-coloured dot trend of one metric over saved sessions. */
export function Sparkline({ points, label }: SparklineProps) {
  if (points.length === 0) return null;
  const pos = positions(points);
  const path = pos
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width="100%"
      height={HEIGHT}
      role="img"
      aria-label={label}
    >
      {points.length > 1 && (
        <path
          d={path}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.55}
        />
      )}
      {pos.map((p, i) => {
        const point = points[i];
        if (!point) return null;
        const meta = bandMeta(point.band);
        return (
          <circle
            key={point.recordedAt + String(i)}
            cx={p.x}
            cy={p.y}
            r={i === pos.length - 1 ? 5 : 4}
            fill={`var(${meta.varName})`}
            stroke={`var(${meta.varName})`}
            strokeWidth={2}
          />
        );
      })}
    </svg>
  );
}
