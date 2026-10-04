import { describe, expect, it } from "vitest";
import { type BandTone, bandMeta } from "./bandColor";

describe("bandMeta", () => {
  it("maps good to the green band variables", () => {
    expect(bandMeta("good")).toEqual({
      varName: "--band-good",
      softVarName: "--band-good-soft",
      label: "Steady",
    });
  });
  it("maps moderate to the amber band variables", () => {
    expect(bandMeta("moderate")).toEqual({
      varName: "--band-moderate",
      softVarName: "--band-moderate-soft",
      label: "Watch",
    });
  });
  it("maps limited to the coral band variables", () => {
    expect(bandMeta("limited")).toEqual({
      varName: "--band-limited",
      softVarName: "--band-limited-soft",
      label: "Follow up",
    });
  });
  it("covers every BandTone", () => {
    const tones: BandTone[] = ["good", "moderate", "limited"];
    for (const tone of tones) {
      expect(bandMeta(tone).label.length).toBeGreaterThan(0);
    }
  });
});
