import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { clearJevKey, fetchJevKeyStatus, setJevKey } from "./jevApi";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);
beforeEach(() => { invokeMock.mockReset(); });

describe("Jev credential bridge", () => {
  it.each([
    { configured: true, source: "keychain" },
    { configured: true, source: "environment" },
    { configured: false, source: null },
  ])("validates credential status %j", async (status) => {
    invokeMock.mockResolvedValue(status);
    expect(await fetchJevKeyStatus()).toEqual(status);
    expect(invokeMock).toHaveBeenCalledWith("questionnaire_key_status", {});
  });
  it.each([
    { configured: true, source: "unknown" },
    { configured: true, source: null },
    { configured: false, source: "keychain" },
    { configured: true, source: "keychain", key: "should-not-be-returned" },
  ])("rejects malformed status %j", async (status) => {
    invokeMock.mockResolvedValue(status);
    await expect(fetchJevKeyStatus()).rejects.toThrow();
  });
  it("saves only through the questionnaire credential command", async () => {
    invokeMock.mockResolvedValue(null);
    await setJevKey("test-placeholder");
    expect(invokeMock).toHaveBeenCalledWith("questionnaire_set_key", { key: "test-placeholder" });
  });
  it("clears through the questionnaire credential command", async () => {
    invokeMock.mockResolvedValue(null);
    await clearJevKey();
    expect(invokeMock).toHaveBeenCalledWith("questionnaire_clear_key", {});
  });
  it("surfaces unavailable keychain errors without claiming success", async () => {
    invokeMock.mockRejectedValue({ code: "keychain_error", message: "Unable to access TypeSafe keychain credentials" });
    await expect(fetchJevKeyStatus()).rejects.toMatchObject({ code: "keychain_error" });
    await expect(setJevKey("test-placeholder")).rejects.toMatchObject({ code: "keychain_error" });
    await expect(clearJevKey()).rejects.toMatchObject({ code: "keychain_error" });
  });
});
