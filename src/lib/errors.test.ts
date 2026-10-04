import { describe, expect, it } from "vitest";
import { toMessage } from "./errors";

describe("toMessage", () => {
  it("returns the message of an Error", () => {
    expect(toMessage(new Error("boom"))).toBe("boom");
  });

  it("returns the message of an Error subclass", () => {
    class HttpError extends Error {}
    expect(toMessage(new HttpError("404"))).toBe("404");
  });

  it("stringifies a non-Error value", () => {
    expect(toMessage("plain string")).toBe("plain string");
    expect(toMessage(42)).toBe("42");
    expect(toMessage(null)).toBe("null");
    expect(toMessage(undefined)).toBe("undefined");
  });

  it("returns the message from a typed IPC payload", () => {
    expect(toMessage({ code: "missing_token", message: "Token missing" })).toBe(
      "Token missing",
    );
  });

  it("stringifies an object without throwing", () => {
    expect(toMessage({ code: 1 })).toBe("[object Object]");
  });
});
