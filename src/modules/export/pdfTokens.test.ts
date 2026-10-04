import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pdfColor, pdfLayout } from "./pdfTokens";

const cssPath = fileURLToPath(new URL("../../ui/tokens.css", import.meta.url));
const css = readFileSync(cssPath, "utf8").toLowerCase();

describe("pdf tokens mirror src/ui/tokens.css", () => {
  it.each(Object.entries(pdfColor))("%s value appears in tokens.css", (_name, value) => {
    expect(css).toContain(value.toLowerCase());
  });

  it("content width fills the page between margins", () => {
    expect(pdfLayout.margin * 2 + pdfLayout.contentWidth).toBe(pdfLayout.pageWidth);
  });
});
