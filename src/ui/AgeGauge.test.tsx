import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { AgeGauge } from "./AgeGauge";

describe("AgeGauge", () => {
  it("renders with basic voice age and mae years", () => {
    const html = renderToString(
      <AgeGauge voiceAge={65} maeYears={7.6} statedAge={null} size="md" />,
    );

    expect(html).toContain("age-gauge");
    expect(html).toContain("age-gauge--md");
    expect(html).toContain("~65 yrs");
    expect(html).toContain("Voice age estimate · ±7.6 yrs");
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Voice age estimate 65 years, plus or minus 7.6 years"');
    expect(html).toContain("<title>Voice age estimate 65 years, plus or minus 7.6 years</title>");
    expect(html).toContain("age-gauge__track");
    expect(html).toContain("age-gauge__band");
    expect(html).toContain("age-gauge__band-edge");
    expect(html).toContain("age-gauge__needle");
    expect(html).toContain(">40<");
    expect(html).toContain(">70<");
    expect(html).toContain(">100<");
    expect(html).not.toContain("age-gauge__stated-marker");
    expect(html).not.toContain("age-gauge__relation");
  });

  it("renders stated age marker and relation line when within error", () => {
    const html = renderToString(
      <AgeGauge voiceAge={68.2} maeYears={7.6} statedAge={70} size="sm" />,
    );

    expect(html).toContain("age-gauge--sm");
    expect(html).toContain("~68 yrs");
    expect(html).toContain("You: 70");
    expect(html).toContain("Within model error of your stated age");
    expect(html).toContain(
      'aria-label="Voice age estimate 68 years, plus or minus 7.6 years, stated age 70"',
    );
  });

  it("renders younger than stated when voiceAge < statedAge by more than mae", () => {
    const html = renderToString(
      <AgeGauge voiceAge={55} maeYears={7.6} statedAge={70} />,
    );

    expect(html).toContain("~55 yrs");
    expect(html).toContain("About 15 years younger than stated");
  });

  it("renders older than stated when voiceAge > statedAge by more than mae", () => {
    const html = renderToString(
      <AgeGauge voiceAge={82} maeYears={7.6} statedAge={70} />,
    );

    expect(html).toContain("~82 yrs");
    expect(html).toContain("About 12 years older than stated");
  });

  it("clamps values below 40 and above 100 gracefully", () => {
    const htmlLow = renderToString(
      <AgeGauge voiceAge={30} maeYears={5} statedAge={35} />,
    );
    expect(htmlLow).toContain("~30 yrs");
    expect(htmlLow).toContain("You: 35");

    const htmlHigh = renderToString(
      <AgeGauge voiceAge={110} maeYears={5} statedAge={105} />,
    );
    expect(htmlHigh).toContain("~110 yrs");
    expect(htmlHigh).toContain("You: 105");
  });
});
