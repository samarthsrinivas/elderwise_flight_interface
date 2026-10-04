import { afterEach, describe, expect, it, vi } from "vitest";
import { interpretYesNo, isRecognitionSupported } from "./speech";

class FakeSpeechRecognition {}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isRecognitionSupported", () => {
  it("does not enable Web Speech recognition inside a Tauri webview", () => {
    vi.stubGlobal("isTauri", true);
    vi.stubGlobal("window", { webkitSpeechRecognition: FakeSpeechRecognition });

    expect(isRecognitionSupported()).toBe(false);
  });

  it("allows Web Speech recognition in a regular browser runtime", () => {
    vi.stubGlobal("isTauri", false);
    vi.stubGlobal("window", { SpeechRecognition: FakeSpeechRecognition });

    expect(isRecognitionSupported()).toBe(true);
  });
});

describe("interpretYesNo", () => {
  it.each(["yes", "Yeah", "yep", "correct", "I do", "I have", "true"])(
    "reads %s as yes",
    (phrase) => {
      expect(interpretYesNo(phrase)).toBe(true);
    },
  );

  it.each(["I can", "I can climb a flight of stairs"])(
    "reads ability phrasing %s as yes",
    (phrase) => {
      expect(interpretYesNo(phrase)).toBe(true);
    },
  );

  it.each([
    "no",
    "Nope",
    "nah",
    "I don't",
    "I do not",
    "I haven't",
    "false",
    "never",
  ])("reads %s as no", (phrase) => {
    expect(interpretYesNo(phrase)).toBe(false);
  });

  it.each(["I can't", "I cannot", "I cannot run a short distance"])(
    "reads inability phrasing %s as no",
    (phrase) => {
      expect(interpretYesNo(phrase)).toBe(false);
    },
  );

  it("is case-insensitive and tolerates surrounding whitespace", () => {
    expect(interpretYesNo("  YES  ")).toBe(true);
    expect(interpretYesNo("  No thanks ")).toBe(false);
  });

  it("returns undefined when neither yes nor no is present", () => {
    expect(interpretYesNo("maybe")).toBeUndefined();
    expect(interpretYesNo("")).toBeUndefined();
    expect(interpretYesNo("I am not sure about this")).toBeUndefined();
  });

  it("matches an affirmative embedded in a longer utterance", () => {
    expect(interpretYesNo("well yes I think so")).toBe(true);
  });
});
