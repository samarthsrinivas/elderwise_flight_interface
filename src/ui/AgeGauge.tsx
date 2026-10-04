import "./ageGauge.css";

export interface AgeGaugeProps {
  readonly voiceAge: number;          // model estimate in years
  readonly maeYears: number;          // model mean absolute error, e.g. 7.6
  readonly statedAge: number | null;  // participant's self-reported age, may be null
  readonly size?: "sm" | "md";        // sm ≈ 220px wide (for inline use), md ≈ 320px wide
}

const MIN_AGE = 40;
const MAX_AGE = 100;
const AGE_SPAN = 60;

const CX = 120;
const CY = 115;
const RADIUS = 85;
const VIEWBOX_HEIGHT = 130;

function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max);
}

// Arc angle formula: left = 40 yrs (π rad), right = 100 yrs (0 rad)
function ageToAngle(age: number): number {
  const clamped = clamp(age, MIN_AGE, MAX_AGE);
  return Math.PI - (Math.PI * (clamped - MIN_AGE)) / AGE_SPAN;
}

function polarToCartesian(cx: number, cy: number, r: number, angleRad: number) {
  return {
    x: cx + r * Math.cos(angleRad),
    y: cy - r * Math.sin(angleRad),
  };
}

function describeArc(cx: number, cy: number, r: number, startAge: number, endAge: number): string {
  const startAng = ageToAngle(startAge);
  const endAng = ageToAngle(endAge);
  const pStart = polarToCartesian(cx, cy, r, startAng);
  const pEnd = polarToCartesian(cx, cy, r, endAng);
  return `M ${pStart.x.toFixed(2)} ${pStart.y.toFixed(2)} A ${r} ${r} 0 0 1 ${pEnd.x.toFixed(2)} ${pEnd.y.toFixed(2)}`;
}

export function AgeGauge({ voiceAge, maeYears, statedAge, size = "md" }: AgeGaugeProps) {
  const roundedVoiceAge = Math.round(voiceAge);
  const strokeWidth = size === "sm" ? 12 : 14;

  const bandStartAge = clamp(voiceAge - maeYears, MIN_AGE, MAX_AGE);
  const bandEndAge = clamp(voiceAge + maeYears, MIN_AGE, MAX_AGE);

  const voiceAng = ageToAngle(voiceAge);
  const needleInner = polarToCartesian(CX, CY, RADIUS - strokeWidth / 2 - 2, voiceAng);
  const needleOuter = polarToCartesian(CX, CY, RADIUS + strokeWidth / 2 + 3, voiceAng);
  const needleCenter = polarToCartesian(CX, CY, RADIUS, voiceAng);

  const trackPath = describeArc(CX, CY, RADIUS, MIN_AGE, MAX_AGE);
  const bandPath = describeArc(CX, CY, RADIUS, bandStartAge, bandEndAge);

  let statedInfo = null;
  if (statedAge !== null && Number.isFinite(statedAge)) {
    const statedAng = ageToAngle(statedAge);
    const sInner = polarToCartesian(CX, CY, RADIUS - strokeWidth / 2 - 4, statedAng);
    const sOuter = polarToCartesian(CX, CY, RADIUS + strokeWidth / 2 + 5, statedAng);
    const sCenter = polarToCartesian(CX, CY, RADIUS, statedAng);
    const sLabelPos = polarToCartesian(CX, CY, RADIUS - strokeWidth / 2 - 16, statedAng);
    const labelAnchor: "start" | "middle" | "end" =
      statedAng > (Math.PI * 3) / 4 ? "start" : statedAng < Math.PI / 4 ? "end" : "middle";
    statedInfo = {
      inner: sInner,
      outer: sOuter,
      center: sCenter,
      labelPos: sLabelPos,
      labelAnchor,
      clampedAge: Math.round(statedAge),
    };
  }

  let relationText: string | null = null;
  if (statedAge !== null && Number.isFinite(statedAge)) {
    const gap = roundedVoiceAge - statedAge;
    if (Math.abs(gap) <= maeYears) {
      relationText = "Within model error of your stated age";
    } else if (gap < 0) {
      relationText = `About ${Math.abs(gap)} years younger than stated`;
    } else {
      relationText = `About ${Math.abs(gap)} years older than stated`;
    }
  }

  const ariaParts = [
    `Voice age estimate ${roundedVoiceAge} years, plus or minus ${maeYears.toFixed(1)} years`,
  ];
  if (statedAge !== null && Number.isFinite(statedAge)) {
    ariaParts.push(`stated age ${statedAge}`);
  }
  const ariaLabel = ariaParts.join(", ");

  const pos40 = polarToCartesian(CX, CY, RADIUS + strokeWidth / 2 + 10, Math.PI);
  const pos70 = polarToCartesian(CX, CY, RADIUS + strokeWidth / 2 + 10, Math.PI / 2);
  const pos100 = polarToCartesian(CX, CY, RADIUS + strokeWidth / 2 + 10, 0);

  return (
    <figure
      className={`age-gauge age-gauge--${size}`}
      role="img"
      aria-label={ariaLabel}
    >
      <svg
        className="age-gauge__svg"
        viewBox={`0 0 240 ${VIEWBOX_HEIGHT}`}
      >
        <title>{ariaLabel}</title>

        {/* Track */}
        <path
          d={trackPath}
          className="age-gauge__track"
          strokeWidth={strokeWidth}
          aria-hidden="true"
        />

        {/* Confidence band */}
        <path
          d={bandPath}
          className="age-gauge__band-edge"
          strokeWidth={strokeWidth}
          aria-hidden="true"
        />
        <path
          d={bandPath}
          className="age-gauge__band"
          strokeWidth={strokeWidth - 2}
          aria-hidden="true"
        />

        {/* Scale labels */}
        <text
          x={pos40.x}
          y={pos40.y + 4}
          textAnchor="start"
          className="age-gauge__scale-label"
          aria-hidden="true"
        >
          40
        </text>
        <text
          x={pos70.x}
          y={pos70.y - 4}
          textAnchor="middle"
          className="age-gauge__scale-label"
          aria-hidden="true"
        >
          70
        </text>
        <text
          x={pos100.x}
          y={pos100.y + 4}
          textAnchor="end"
          className="age-gauge__scale-label"
          aria-hidden="true"
        >
          100
        </text>

        {/* Stated age marker */}
        {statedInfo && (
          <g className="age-gauge__stated-marker" aria-hidden="true">
            <line
              x1={statedInfo.inner.x.toFixed(2)}
              y1={statedInfo.inner.y.toFixed(2)}
              x2={statedInfo.outer.x.toFixed(2)}
              y2={statedInfo.outer.y.toFixed(2)}
              strokeWidth={2}
              className="age-gauge__stated-line"
            />
            <circle
              cx={statedInfo.center.x.toFixed(2)}
              cy={statedInfo.center.y.toFixed(2)}
              r={2.5}
              className="age-gauge__stated-circle"
            />
            <text
              x={statedInfo.labelPos.x.toFixed(2)}
              y={statedInfo.labelPos.y.toFixed(2)}
              textAnchor={statedInfo.labelAnchor}
              className="age-gauge__stated-label"
            >
              {`You: ${statedInfo.clampedAge}`}
            </text>
          </g>
        )}

        {/* Voice age needle / marker */}
        <g className="age-gauge__needle" aria-hidden="true">
          <line
            x1={needleInner.x.toFixed(2)}
            y1={needleInner.y.toFixed(2)}
            x2={needleOuter.x.toFixed(2)}
            y2={needleOuter.y.toFixed(2)}
            strokeWidth={3}
            className="age-gauge__needle-line"
          />
          <circle
            cx={needleCenter.x.toFixed(2)}
            cy={needleCenter.y.toFixed(2)}
            r={3.5}
            className="age-gauge__needle-circle"
          />
        </g>
      </svg>

      <div className="age-gauge__content">
        <h4 className="age-gauge__headline">{`~${roundedVoiceAge} yrs`}</h4>
        <p className="age-gauge__caption">
          {`Voice age estimate · ±${maeYears.toFixed(1)} yrs`}
        </p>
        {relationText && (
          <p className="age-gauge__relation">{relationText}</p>
        )}
      </div>
    </figure>
  );
}
