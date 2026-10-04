import type { BandTone } from "../../ui/bandColor";

/** PDF color constants mirroring src/ui/tokens.css (drift-guarded by test). */
export const pdfColor = {
  accent: "#0ea5a4",
  accentStrong: "#0b8482",
  accentSoft: "#d6f3f2",
  bandGood: "#16a34a",
  bandGoodSoft: "#dcfce7",
  bandModerate: "#d97706",
  bandModerateSoft: "#fef3c7",
  bandLimited: "#dc2626",
  bandLimitedSoft: "#fee2e2",
  border: "#e5e9f0",
  surfaceMuted: "#eef2f6",
  text: "#16202e",
  textMuted: "#5a6a7d",
  textSubtle: "#8091a3",
} as const;

export interface BandInk {
  readonly main: string;
  readonly soft: string;
}

export const bandInk: Record<BandTone, BandInk> = {
  good: { main: pdfColor.bandGood, soft: pdfColor.bandGoodSoft },
  moderate: { main: pdfColor.bandModerate, soft: pdfColor.bandModerateSoft },
  limited: { main: pdfColor.bandLimited, soft: pdfColor.bandLimitedSoft },
};

/** A4 portrait geometry in millimetres. */
export const pdfLayout = {
  pageWidth: 210,
  pageHeight: 297,
  margin: 18,
  contentWidth: 174,
  headerHeight: 30,
  footerHeight: 18,
} as const;
