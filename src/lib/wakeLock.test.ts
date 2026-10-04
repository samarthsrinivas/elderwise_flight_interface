import { describe, expect, it, vi } from "vitest";
import { requestScreenWakeLock } from "./wakeLock";

function fakeSentinel(release = vi.fn().mockResolvedValue(undefined)) {
  const listeners: Array<() => void> = [];
  return {
    sentinel: {
      release,
      addEventListener: (_type: "release", listener: () => void) => {
        listeners.push(listener);
      },
    },
    release,
    fireRelease: () => listeners.forEach((l) => l()),
  };
}

describe("requestScreenWakeLock", () => {
  it("holds a real lock when the API is available", async () => {
    const { sentinel, release } = fakeSentinel();
    const request = vi.fn().mockResolvedValue(sentinel);

    const handle = await requestScreenWakeLock({ wakeLock: { request } });

    expect(request).toHaveBeenCalledWith("screen");
    expect(handle.held).toBe(true);

    await handle.release();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("degrades to a no-op where the API does not exist", async () => {
    // iPadOS below 16.4, and any platform without Screen Wake Lock.
    const handle = await requestScreenWakeLock({});

    expect(handle.held).toBe(false);
    await expect(handle.release()).resolves.toBeUndefined();
  });

  it("degrades to a no-op when the request is refused", async () => {
    // iOS refuses while the page is hidden or in Low Power Mode. A capture
    // must still run; it is simply unprotected from auto-lock.
    const request = vi.fn().mockRejectedValue(new Error("NotAllowedError"));

    const handle = await requestScreenWakeLock({ wakeLock: { request } });

    expect(handle.held).toBe(false);
    await expect(handle.release()).resolves.toBeUndefined();
  });

  it("does not release a sentinel iOS already reclaimed", async () => {
    // iOS drops the lock when the page is hidden and never restores it.
    const { sentinel, release, fireRelease } = fakeSentinel();
    const handle = await requestScreenWakeLock({
      wakeLock: { request: vi.fn().mockResolvedValue(sentinel) },
    });

    fireRelease();
    await handle.release();

    expect(release).not.toHaveBeenCalled();
  });

  it("releases at most once", async () => {
    const { sentinel, release } = fakeSentinel();
    const handle = await requestScreenWakeLock({
      wakeLock: { request: vi.fn().mockResolvedValue(sentinel) },
    });

    await handle.release();
    await handle.release();

    expect(release).toHaveBeenCalledTimes(1);
  });

  it("survives a sentinel that throws on release", async () => {
    const release = vi.fn().mockRejectedValue(new Error("already released"));
    const { sentinel } = fakeSentinel(release);
    const handle = await requestScreenWakeLock({
      wakeLock: { request: vi.fn().mockResolvedValue(sentinel) },
    });

    await expect(handle.release()).resolves.toBeUndefined();
  });
});
