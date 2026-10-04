import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * iPadOS behaviour that is invisible on a desktop pointer and therefore easy
 * to regress. These rules are the difference between a usable tablet app and
 * one an elderly participant cannot operate, so they are pinned here.
 */
const appCss = readFileSync(new URL("../App.css", import.meta.url), "utf8");
const indexHtml = readFileSync(new URL("../../index.html", import.meta.url), "utf8");

describe("iPad viewport", () => {
  it("opts into the safe-area insets", () => {
    // env(safe-area-inset-*) reports 0 without viewport-fit=cover.
    expect(indexHtml).toMatch(/viewport-fit=cover/);
  });

  it("does not disable pinch zoom", () => {
    // Pinch zoom is an accessibility affordance for this app's users; iOS
    // honours user-scalable=no, so adding it would take that away.
    expect(indexHtml).not.toMatch(/user-scalable\s*=\s*no/);
    expect(indexHtml).not.toMatch(/maximum-scale/);
  });
});

describe("iPad touch targets", () => {
  it("gives every button at least Apple's 44pt minimum", () => {
    expect(appCss).toMatch(/button\s*\{[^}]*min-height:\s*44px/);
  });

  it("enlarges checkboxes and radios beyond their tiny default", () => {
    expect(appCss).toMatch(
      /input\[type="checkbox"\],\s*\n\s*input\[type="radio"\]\s*\{[^}]*width:\s*24px/,
    );
  });

  it("keeps text inputs at 16px or more so iOS does not zoom on focus", () => {
    // Below 16px, focusing a field makes iOS zoom the page and leaves the
    // layout scrolled sideways with no obvious way back.
    expect(appCss).toMatch(/font-size:\s*max\(16px,/);
  });

  it("removes the double-tap zoom delay on controls", () => {
    expect(appCss).toMatch(/touch-action:\s*manipulation/);
  });
});

describe("iPad layout", () => {
  it("uses the dynamic viewport height for the app shell", () => {
    // 100vh alone is wrong in WKWebView; dvh must be present as well.
    expect(appCss).toMatch(/min-height:\s*100dvh/);
  });

  it("insets the shell from the safe area", () => {
    expect(appCss).toMatch(/env\(safe-area-inset-left\)/);
    expect(appCss).toMatch(/env\(safe-area-inset-bottom\)/);
  });

  it("suppresses selection on the live chair-stand trial surfaces", () => {
    // The participant braces against a propped-up iPad mid-test; a long press
    // must not raise the selection callout over the running trial.
    expect(appCss).toMatch(/-webkit-touch-callout:\s*none/);
  });
});

describe("legibility at arm's length and beyond", () => {
  it("scales the trial count and timer up on touch devices only", () => {
    // The participant reads these standing several feet from a propped-up
    // iPad. Scoped to pointer: coarse so the macOS window is untouched.
    expect(appCss).toMatch(/@media \(pointer: coarse\)/);
    const coarse = appCss.slice(appCss.indexOf("@media (pointer: coarse)"));
    expect(coarse).toMatch(/\.big-count\s*\{[^}]*font-size:\s*min\(18vmin/);
    expect(coarse).toMatch(/\.timer\s*\{[^}]*font-size:\s*min\(10vmin/);
  });
});

const tokensCss = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
const aiSettings = readFileSync(
  new URL("../modules/ai/AiSettingsScreen.tsx", import.meta.url),
  "utf8",
);

describe("narrow iPad panes", () => {
  it("lets every auto-fit grid floor collapse below its track size", () => {
    // In a ~320pt Split View pane a 240px track plus gutters is wider than
    // the pane, and auto-fit will not shrink below the floor - the grid
    // overflows sideways. minmax(min(240px, 100%), 1fr) keeps the intended
    // track on a wide screen and lets it collapse when there is no room.
    const floors = appCss.match(/repeat\(auto-fit,\s*minmax\([^)]*\)?[^;]*;/g) ?? [];
    expect(floors.length).toBeGreaterThan(0);
    for (const rule of floors) {
      expect(rule).toMatch(/minmax\(min\(\d+px,\s*100%\)/);
    }
  });

  it("caps the header controls at the pane width", () => {
    expect(appCss).toMatch(/max-width:\s*min\(16rem,\s*100%\)/);
    expect(appCss).toMatch(/\.locale-switcher select\s*\{[^}]*max-width:\s*100%/);
  });

  it("caps the settings fields instead of pinning them to 18rem", () => {
    // 18rem is 288px - wider than a narrow Split View pane on its own.
    expect(aiSettings).not.toMatch(/minWidth:\s*"18rem"/);
    expect(aiSettings).toMatch(/minWidth:\s*"min\(18rem,\s*100%\)"/);
  });

  it("contains horizontal overflow at the page level", () => {
    // `clip`, not `hidden`: hidden would make .app a scroll container and
    // start scrolling the shell in the wrong axis.
    expect(appCss).toMatch(/\.app\s*\{[^}]*overflow-x:\s*clip/);
    expect(appCss).not.toMatch(/\.app\s*\{[^}]*overflow-x:\s*hidden/);
  });

  it("wraps unbreakable strings rather than widening their column", () => {
    // API keys, model ids and export paths have no break opportunity.
    expect(appCss).toMatch(/overflow-wrap:\s*break-word/);
  });
});

describe("iPad landscape width", () => {
  it("widens the content ceiling past a portrait tablet", () => {
    // Portrait iPad is 820pt and keeps the 760px reading measure; landscape
    // is 1180-1366pt and a 760px column would leave a third of it empty.
    expect(tokensCss).toMatch(/--content-max:\s*760px/);
    const wide = tokensCss.slice(tokensCss.indexOf("@media (min-width: 1024px)"));
    expect(wide).toMatch(/--content-max:\s*1040px/);
  });
});
