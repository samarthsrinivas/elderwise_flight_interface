/** Health band tone shared across result surfaces. */
export type BandTone = "good" | "moderate" | "limited";

export interface BandMeta {
  /** CSS custom property for the solid band color. */
  varName: string;
  /** CSS custom property for the soft tinted background. */
  softVarName: string;
  /** Human label always shown alongside the color (never color alone). */
  label: string;
}

export function bandMeta(tone: BandTone): BandMeta {
  switch (tone) {
    case "good":
      return { varName: "--band-good", softVarName: "--band-good-soft", label: "Steady" };
    case "moderate":
      return {
        varName: "--band-moderate",
        softVarName: "--band-moderate-soft",
        label: "Watch",
      };
    case "limited":
      return {
        varName: "--band-limited",
        softVarName: "--band-limited-soft",
        label: "Follow up",
      };
    default:
      return assertNever(tone);
  }
}

function assertNever(x: never): never {
  throw new Error(`Unexpected band tone: ${String(x)}`);
}
