"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const CONTROLS_IDLE_MS = 2500;

/**
 * Immersive layout state for Live Coach. Focus Mode is a layout first: the
 * camera container fills the viewport with CSS, so it works when the browser
 * refuses fullscreen. Native fullscreen is requested as an enhancement and,
 * when it was ours, leaving it (browser Esc) also leaves Focus Mode.
 */
export function useFocusMode() {
  const [active, setActive] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const ownsFullscreenRef = useRef(false);

  const enter = useCallback(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setControlsVisible(true);
    setActive(true);
    const root = document.documentElement;
    if (document.fullscreenElement || typeof root.requestFullscreen !== "function") return;
    ownsFullscreenRef.current = true;
    root.requestFullscreen({ navigationUI: "hide" }).catch(() => {
      // Denied or unsupported (e.g. iPhone Safari); the layout already fills the viewport.
      ownsFullscreenRef.current = false;
    });
  }, []);

  const exit = useCallback(() => {
    setActive(false);
    if (!ownsFullscreenRef.current) return;
    ownsFullscreenRef.current = false;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, []);

  useEffect(() => {
    if (!active) return;
    // Lock page scroll and release the global stable scrollbar gutter, which
    // would otherwise leave a strip of page background beside the camera.
    const html = document.documentElement;
    const { overflow: previousOverflow, scrollbarGutter: previousGutter } = html.style;
    html.style.overflow = "hidden";
    html.style.scrollbarGutter = "auto";

    let hideTimer = window.setTimeout(() => setControlsVisible(false), CONTROLS_IDLE_MS);
    const reveal = () => {
      setControlsVisible(true);
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => setControlsVisible(false), CONTROLS_IDLE_MS);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        exit();
        return;
      }
      reveal();
      if (event.key === "Tab") trapFocus(event, rootRef.current);
    };
    const onFullscreenChange = () => {
      if (!document.fullscreenElement && ownsFullscreenRef.current) {
        ownsFullscreenRef.current = false;
        setActive(false);
      }
    };

    window.addEventListener("pointermove", reveal);
    window.addEventListener("pointerdown", reveal);
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      html.style.overflow = previousOverflow;
      html.style.scrollbarGutter = previousGutter;
      window.clearTimeout(hideTimer);
      window.removeEventListener("pointermove", reveal);
      window.removeEventListener("pointerdown", reveal);
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, [active, exit]);

  // Hand focus back to the control that opened Focus Mode.
  useEffect(() => {
    if (active) return;
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }, [active]);

  // Leaving the page (e.g. browser Back) must not strand the browser in fullscreen.
  useEffect(() => () => {
    if (ownsFullscreenRef.current && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, []);

  return { active, controlsVisible, rootRef, enter, exit };
}

export type FocusMode = ReturnType<typeof useFocusMode>;

function trapFocus(event: KeyboardEvent, root: HTMLElement | null) {
  if (!root) return;
  const focusable = Array.from(root.querySelectorAll<HTMLElement>("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])"))
    .filter((element) => element.offsetParent !== null);
  if (!focusable.length) {
    event.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const current = document.activeElement;
  if (!root.contains(current)) {
    event.preventDefault();
    first.focus();
  } else if (event.shiftKey && current === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && current === last) {
    event.preventDefault();
    first.focus();
  }
}
