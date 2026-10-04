import { type BandTone, bandMeta } from "./bandColor";

interface Segment {
  tone: BandTone;
  label: string;
  range: string;
}

interface BandScaleProps {
  tone: BandTone;
  segments: readonly Segment[];
}

/** Labeled Low/Moderate/High style rail; the active tone segment is filled,
 *  others are muted. Presentational only. */
export function BandScale({ tone, segments }: BandScaleProps) {
  return (
    <div className="band-scale">
      {segments.map((seg) => {
        const active = seg.tone === tone;
        const meta = bandMeta(seg.tone);
        return (
          <div
            key={seg.label}
            className={active ? "band-scale__seg is-active" : "band-scale__seg"}
            style={
              active
                ? { background: `var(${meta.softVarName})`, color: `var(${meta.varName})` }
                : undefined
            }
          >
            <span className="band-scale__label">{seg.label}</span>
            <span className="band-scale__range">{seg.range}</span>
          </div>
        );
      })}
    </div>
  );
}