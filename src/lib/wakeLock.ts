/**
 * Keeps the screen awake for the duration of a capture.
 *
 * A resting ECG runs for 1 or 5 minutes while the participant sits still and
 * does not touch the screen. An iPad left alone will dim, auto-lock and can
 * suspend the app, dropping the Polar connection part-way through — which the
 * assessment then has to report as an interrupted capture. Holding a screen
 * wake lock for the capture window avoids manufacturing that failure.
 *
 * Screen Wake Lock reached WKWebView in iOS 16.4. Below that, and anywhere the
 * API is missing or the request is refused, callers get a handle whose release
 * is a no-op: the capture still runs, it is simply not protected from
 * auto-lock. This never throws, because failing to dim the screen must never
 * fail an assessment.
 */

interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener?(type: "release", listener: () => void): void;
}

interface WakeLockLike {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}

interface WakeLockNavigator {
  wakeLock?: WakeLockLike;
}

export interface WakeLockHandle {
  /** True when a real lock is held; false when unsupported or refused. */
  readonly held: boolean;
  release: () => Promise<void>;
}

const NOOP: WakeLockHandle = {
  held: false,
  release: async () => {},
};

export async function requestScreenWakeLock(
  nav: WakeLockNavigator | undefined = typeof navigator === "undefined"
    ? undefined
    : (navigator as WakeLockNavigator),
): Promise<WakeLockHandle> {
  const wakeLock = nav?.wakeLock;
  if (!wakeLock || typeof wakeLock.request !== "function") return NOOP;

  try {
    const sentinel = await wakeLock.request("screen");
    let released = false;
    // iOS drops the lock whenever the page is hidden and does not restore it.
    // Track that so a second release() is not attempted on a dead sentinel.
    sentinel.addEventListener?.("release", () => {
      released = true;
    });
    return {
      held: true,
      release: async () => {
        if (released) return;
        released = true;
        try {
          await sentinel.release();
        } catch {
          // A lock the system already reclaimed is not an error worth raising.
        }
      },
    };
  } catch {
    // Refused (page hidden, low power mode, no user activation). Not fatal.
    return NOOP;
  }
}
