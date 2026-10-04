import { type BandTone, bandMeta } from "./bandColor";

interface ScoreHeroProps {
  value: string;
  unit?: string;
  caption: string;
  tone: BandTone;
  /** Localized band label; defaults to the English label from `bandMeta`. */
  bandLabel?: string;
  /** Word after the band label, e.g. "capacity" (default) or "risk". */
  bandLabelSuffix?: string;
}

/** Hero metric for result screens: a large number in a tinted disc with the
 *  band label and a caption. Presentational only. */
export function ScoreHero({
  value,
  unit,
  caption,
  tone,
  bandLabel,
  bandLabelSuffix = "capacity",
}: ScoreHeroProps) {
  const meta = bandMeta(tone);
  return (
    <div className="score-hero">
      <div
        className="score-hero__disc"
        style={{
          background: `var(${meta.softVarName})`,
          color: `var(${meta.varName})`,
        }}
      >
        <span className="score-hero__value">{value}</span>
        {unit && <span className="score-hero__unit">{unit}</span>}
      </div>
      <div className="score-hero__meta">
        <span
          className="score-hero__band"
          style={{ color: `var(${meta.varName})` }}
        >
          {bandLabel ?? meta.label} {bandLabelSuffix}
        </span>
        <span className="score-hero__caption">{caption}</span>
      </div>
    </div>
  );
}
