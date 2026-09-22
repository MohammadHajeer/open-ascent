"use client";

import { useEffect, useState } from "react";
import { Clock3 } from "lucide-react";

import { elapsedSeconds, formatElapsed } from "../duration";

export function useSessionNow(startedAt: string | null): number | null {
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    if (!startedAt) return;
    const update = () => setNowMs(Date.now());
    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [startedAt]);

  return startedAt ? nowMs : null;
}

export function SessionTimer({ startedAt }: { startedAt: string }) {
  const nowMs = useSessionNow(startedAt);
  const seconds = nowMs === null ? null : elapsedSeconds(startedAt, nowMs);

  return (
    <span
      role="timer"
      aria-label={`Workout elapsed time ${seconds === null ? "loading" : formatElapsed(seconds)}`}
      aria-live="off"
      className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/45 px-3 py-1.5 font-mono text-xs tabular-nums text-foreground-soft"
    >
      <Clock3 className="size-3.5 text-primary" aria-hidden="true" />
      {seconds === null ? "--:--:--" : formatElapsed(seconds)}
    </span>
  );
}
