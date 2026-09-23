"use client";

import { useEffect, useRef, useState } from "react";

type RevealState = { key: string | null; text: string };

function revealStep(backlog: number): number {
  if (backlog > 600) return 32;
  if (backlog > 240) return 16;
  if (backlog > 80) return 8;
  if (backlog > 24) return 4;
  return 2;
}

export function useCoachReveal(key: string | null, receivedText: string, status: string, initialText = ""): string {
  const [display, setDisplay] = useState<RevealState>({ key: null, text: "" });
  const received = useRef("");

  useEffect(() => {
    received.current = receivedText;
  }, [key, receivedText]);

  useEffect(() => {
    if (!key || ["completed", "failed", "interrupted"].includes(status)) return;
    const timer = window.setInterval(() => {
      setDisplay(current => {
        const shown = current.key === key ? current.text : initialText;
        const target = received.current;
        if (shown === target) return current;
        if (!target.startsWith(shown)) return { key, text: target };
        return { key, text: target.slice(0, shown.length + revealStep(target.length - shown.length)) };
      });
    }, 16);
    return () => window.clearInterval(timer);
  }, [key, status, initialText]);

  if (!key) return "";
  if (["completed", "failed", "interrupted"].includes(status)) return receivedText;
  return display.key === key ? display.text : initialText;
}
