"use client";

import { useEffect } from "react";

/**
 * Keeps the screen on while `active`: a phone propped on the floor would
 * otherwise dim or lock mid-set and suspend the camera. The browser releases
 * the lock whenever the page is hidden, so it is requested again on return.
 */
export function useScreenWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const request = () => {
      if (document.visibilityState !== "visible" || (sentinel && !sentinel.released)) return;
      navigator.wakeLock.request("screen").then((lock) => {
        if (cancelled) void lock.release().catch(() => {});
        else sentinel = lock;
      }).catch(() => {
        // Denied or unsupported (e.g. battery saver); the session still works.
      });
    };
    const onVisibilityChange = () => request();

    request();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void sentinel?.release().catch(() => {});
    };
  }, [active]);
}
