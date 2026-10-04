import { describe, expect, it } from "vitest";
import infoPlist from "../../../src-tauri/Info.plist?raw";
import entitlements from "../../../src-tauri/Entitlements.plist?raw";
import tauriConfig from "../../../src-tauri/tauri.conf.json";

describe("macOS microphone permission configuration", () => {
  it("declares why Elderwise needs microphone and camera access", () => {
    expect(infoPlist).toContain("<key>NSMicrophoneUsageDescription</key>");
    expect(infoPlist).toContain("Elderwise uses your microphone");
    expect(infoPlist).toContain("<key>NSCameraUsageDescription</key>");
  });

  it("signs the hardened macOS app with the audio input entitlement", () => {
    expect(tauriConfig.bundle?.macOS?.hardenedRuntime).toBe(true);
    expect(tauriConfig.bundle?.macOS?.entitlements).toBe("./Entitlements.plist");
    expect(entitlements).toContain("<key>com.apple.security.device.audio-input</key>");
    expect(entitlements).toContain("<true/>");
  });
});
